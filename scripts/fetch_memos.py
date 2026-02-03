#!/usr/bin/env python3
"""
GEOINT Memo Fetcher - Cron-Optimized Version
Fetches NEW memos from the GEOINT PDA and merges with existing memos.json

Designed for cron job usage:
- Never deletes existing memos
- Only adds new memos not already in the file
- Atomic file writes to prevent corruption
- Minimal RPC calls (stops when it hits known signatures)

Usage:
    python fetch_memos.py              # Normal incremental update
    python fetch_memos.py --full       # Full rescan (still preserves existing)
    python fetch_memos.py --output /path/to/memos.json

Cron example (every 5 minutes):
    */5 * * * * cd /var/www/html/geoint && python3 scripts/fetch_memos.py >> /var/log/geoint_memos.log 2>&1
"""

import json
import base64
import time
import os
import sys
import argparse
from datetime import datetime
from typing import Optional, List, Dict, Any, Set
import requests

# ============ Configuration ============
PDA_ADDRESS = "HQvMbrAMGjMkcobUV56MN9zaryPo9NarLddrEfc1wmLP"
MEMO_PROGRAMS = [
    "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
]

# RPC endpoints (ordered by reliability)
RPC_ENDPOINTS = [
    "https://api.mainnet-beta.solana.com",
    "https://solana.drpc.org",
    "https://rpc.ankr.com/solana",
    "https://solana-api.projectserum.com"
]

CHUNK_SIZE = 100  # Smaller chunks for incremental updates
REQUEST_TIMEOUT = 30
RATE_LIMIT_DELAY = 0.3  # Faster for cron jobs
MAX_NEW_MEMOS = 50  # Stop after finding this many new memos (optimization)


class SolanaRPC:
    """Simple Solana RPC client with fallback support."""
    
    def __init__(self, endpoints: List[str]):
        self.endpoints = endpoints
        self.active_endpoint = None
        self.request_count = 0
    
    def call(self, method: str, params: List[Any]) -> Optional[Any]:
        """Make an RPC call with automatic endpoint fallback."""
        body = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        }
        
        # Try active endpoint first
        endpoints_to_try = self.endpoints.copy()
        if self.active_endpoint and self.active_endpoint in endpoints_to_try:
            endpoints_to_try.remove(self.active_endpoint)
            endpoints_to_try.insert(0, self.active_endpoint)
        
        for endpoint in endpoints_to_try:
            try:
                self.request_count += 1
                response = requests.post(
                    endpoint,
                    json=body,
                    headers={"Content-Type": "application/json"},
                    timeout=REQUEST_TIMEOUT
                )
                
                if response.status_code == 429:
                    time.sleep(2)
                    continue
                
                data = response.json()
                
                if "result" in data:
                    self.active_endpoint = endpoint
                    return data["result"]
                elif "error" in data:
                    err = data["error"]
                    err_msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
                    continue
                    
            except requests.exceptions.Timeout:
                continue
            except requests.exceptions.RequestException:
                continue
            except json.JSONDecodeError:
                continue
        
        return None


def decode_memo_data(data: str) -> Optional[str]:
    """Decode base64 memo data to string."""
    try:
        decoded = base64.b64decode(data).decode('utf-8')
        return decoded.replace('\x00', '').strip()
    except Exception:
        return None


def extract_memo_from_tx(tx: Dict, signature: str) -> Optional[Dict]:
    """Extract memo content and metadata from a transaction."""
    if not tx:
        return None
    
    try:
        instructions = tx.get("transaction", {}).get("message", {}).get("instructions", [])
        inner_instructions = tx.get("meta", {}).get("innerInstructions", [])
        
        all_instructions = list(instructions)
        for inner in inner_instructions:
            all_instructions.extend(inner.get("instructions", []))
        
        memo_content = None
        for ix in all_instructions:
            program_id = ix.get("programId", "")
            
            if program_id in MEMO_PROGRAMS or ix.get("program") == "spl-memo":
                if ix.get("program") == "spl-memo" and isinstance(ix.get("parsed"), str):
                    memo_content = ix["parsed"]
                    break
                elif "data" in ix:
                    decoded = decode_memo_data(ix["data"])
                    if decoded:
                        memo_content = decoded
                        break
        
        if not memo_content or len(memo_content) == 0:
            return None
        
        account_keys = tx.get("transaction", {}).get("message", {}).get("accountKeys", [])
        author = "Unknown"
        for key in account_keys:
            if isinstance(key, dict) and key.get("signer"):
                author = key.get("pubkey", "Unknown")
                break
            elif isinstance(key, str):
                author = key
                break
        
        block_time = tx.get("blockTime")
        timestamp = block_time * 1000 if block_time else None
        
        return {
            "signature": signature,
            "author": author,
            "content": memo_content,
            "timestamp": timestamp,
            "datetime": datetime.fromtimestamp(block_time).isoformat() if block_time else None
        }
        
    except Exception:
        return None


def load_existing_memos(output_file: str) -> tuple[List[Dict], Set[str]]:
    """Load existing memos from JSON file and return (memos, known_signatures)."""
    existing_memos = []
    known_sigs = set()
    
    if os.path.exists(output_file):
        try:
            with open(output_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                existing_memos = data.get("memos", [])
                known_sigs = {m["signature"] for m in existing_memos}
                print(f"[{datetime.now().strftime('%H:%M:%S')}] Loaded {len(existing_memos)} existing memos")
        except (json.JSONDecodeError, KeyError) as e:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Warning: Could not parse existing file: {e}")
            # Don't wipe - keep empty but don't error
    
    return existing_memos, known_sigs


def save_memos_atomic(output_file: str, memos: List[Dict], stats: Dict):
    """Atomically save memos to avoid corruption during writes."""
    output_data = {
        "pda_address": PDA_ADDRESS,
        "last_updated": datetime.now().isoformat(),
        "total_memos": len(memos),
        "last_fetch_stats": stats,
        "memos": memos
    }
    
    # Write to temp file first
    temp_file = output_file + ".tmp"
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
    
    # Atomic rename
    os.replace(temp_file, output_file)


def fetch_memos_incremental(output_file: str = "memos.json", full_scan: bool = False):
    """
    Fetch NEW memos and merge with existing ones.
    
    Args:
        output_file: Path to memos.json
        full_scan: If True, scan all history (still merges, never deletes)
    """
    start_time = datetime.now()
    print(f"\n[{start_time.strftime('%H:%M:%S')}] GEOINT Memo Sync Starting...")
    
    # Load existing memos
    existing_memos, known_sigs = load_existing_memos(output_file)
    
    rpc = SolanaRPC(RPC_ENDPOINTS)
    new_memos = []
    before_cursor = None
    page = 0
    hit_known = False
    
    while len(new_memos) < MAX_NEW_MEMOS:
        page += 1
        
        params = {"limit": CHUNK_SIZE, "commitment": "confirmed"}
        if before_cursor:
            params["before"] = before_cursor
        
        signatures_result = rpc.call("getSignaturesForAddress", [PDA_ADDRESS, params])
        
        if not signatures_result or len(signatures_result) == 0:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] End of history")
            break
        
        # Process signatures
        for sig_info in signatures_result:
            if sig_info.get("err"):
                continue
            
            signature = sig_info["signature"]
            
            # OPTIMIZATION: If we've seen this signature, stop scanning
            if signature in known_sigs:
                if not full_scan:
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Hit known signature, stopping")
                    hit_known = True
                    break
                continue  # In full_scan mode, skip but continue
            
            # Rate limit
            time.sleep(RATE_LIMIT_DELAY)
            
            # Fetch transaction
            tx_result = rpc.call("getTransaction", [
                signature,
                {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0, "commitment": "confirmed"}
            ])
            
            if tx_result:
                memo = extract_memo_from_tx(tx_result, signature)
                if memo:
                    new_memos.append(memo)
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] + New memo: {memo['author'][:8]}...")
                    
                    if len(new_memos) >= MAX_NEW_MEMOS:
                        break
        
        if hit_known:
            break
        
        # Next page
        before_cursor = signatures_result[-1]["signature"]
        
        if len(signatures_result) < CHUNK_SIZE:
            break
    
    # Merge: new memos + existing (deduplicated)
    all_memos_map = {m["signature"]: m for m in existing_memos}
    for m in new_memos:
        all_memos_map[m["signature"]] = m  # New overwrites if duplicate
    
    final_memos = list(all_memos_map.values())
    final_memos.sort(key=lambda m: m.get("timestamp") or 0, reverse=True)
    
    # Stats for logging
    stats = {
        "run_time": str(datetime.now() - start_time),
        "new_memos_found": len(new_memos),
        "total_after_merge": len(final_memos),
        "rpc_requests": rpc.request_count
    }
    
    # Save atomically
    save_memos_atomic(output_file, final_memos, stats)
    
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Complete: +{len(new_memos)} new, {len(final_memos)} total")
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Saved to: {output_file}")
    
    return new_memos


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch GEOINT memos (cron-safe)")
    parser.add_argument("--output", "-o", type=str, default="memos.json", help="Output JSON file")
    parser.add_argument("--full", action="store_true", help="Full rescan (still preserves existing)")
    args = parser.parse_args()
    
    # Ensure we're in the right directory for relative paths
    script_dir = os.path.dirname(os.path.abspath(__file__))
    if args.output == "memos.json":
        # Default to parent directory (html/)
        args.output = os.path.join(os.path.dirname(script_dir), "memos.json")
    
    fetch_memos_incremental(output_file=args.output, full_scan=args.full)
