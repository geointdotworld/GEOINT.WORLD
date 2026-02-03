from reportlab.lib.pagesizes import LETTER
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Image, Table, TableStyle, Macro, Flowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.lib.units import inch
from datetime import datetime
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Group, PolyLine
from reportlab.graphics import renderPDF

# Theme Constants
THEME_ORANGE = colors.HexColor("#ff6800")
THEME_BG = colors.black
THEME_FONT = 'Courier-Bold'

def create_tokenomics_chart():
    # Canvas size matching content width (approx 6.5 inches = 468 pts)
    # Increased height to 550 to accommodate extra level
    d = Drawing(468, 550)
    
    # Constants
    ORANGE = colors.HexColor("#ff6800")
    BLACK = colors.black
    WHITE = colors.white
    FONT = 'Courier-Bold' # Ensuring Bold Font
    
    def create_box(x, y, w, h, text_lines, bg_color=ORANGE, text_color=WHITE, fontSize=10):
        g = Group()
        g.add(Rect(x, y, w, h, fill=1, stroke=0, fillColor=bg_color))
        line_height = fontSize * 1.2
        # Center visually: Midpoint of baselines shifted down by ~0.3*fontSize to account for cap-height vs descent
        start_y = y + h/2 + (len(text_lines)-1)*(line_height/2) - (0.3 * fontSize)
        for i, line in enumerate(text_lines):
            y_pos = start_y - i*line_height
            s = String(x + w/2, y_pos, line, textAnchor='middle', fontName=FONT, fontSize=fontSize, fillColor=text_color)
            g.add(s)
            
            # Underline specific text
            if "Example Swap" in line:
                text_width = stringWidth(line, FONT, fontSize)
                lx1 = (x + w/2) - (text_width/2)
                lx2 = (x + w/2) + (text_width/2)
                ly = y_pos - 4
                g.add(Line(lx1, ly, lx2, ly, strokeColor=text_color, strokeWidth=1.5))
        return g

    def create_text(x, y, text_lines, color=ORANGE, fontSize=13):
        g = Group()
        line_height = fontSize * 1.2
        for i, line in enumerate(text_lines):
            y_pos = y - i*line_height
            s = String(x, y_pos, line, textAnchor='middle', fontName=FONT, fontSize=fontSize, fillColor=color)
            g.add(s)
            
            # Underline Bags.fm
            if "Bags.fm" in line:
                text_width = stringWidth(line, FONT, fontSize)
                lx1 = x - (text_width/2)
                lx2 = x + (text_width/2)
                ly = y_pos - 2
                g.add(Line(lx1, ly, lx2, ly, strokeColor=color, strokeWidth=1))
        return g

    # --- Level 1: Initial Purchase ---
    # Draw "Swap Fee Structure" as Orange Text above
    title_text = "Swap Fee Structure"
    d.add(create_text(234, 500, [title_text], color=ORANGE, fontSize=20))
    # Separator line removed as requested
    
    # Draw smaller box for "$100 Example Swap"
    # User requested box width to match text width
    text_content = "$100 Example Swap"
    text_w = stringWidth(text_content, FONT, 20)
    box_w = text_w + 30 # Add padding
    box_x = 234 - (box_w / 2) # Center at 234
    
    d.add(create_box(box_x, 450, box_w, 40, [text_content], text_color=BLACK, fontSize=20))
    d.add(Line(234, 452, 234, 360, strokeColor=ORANGE, strokeWidth=3))
    
    # Split: Left to 130, Right to 313
    d.add(PolyLine([(130, 345), (130, 360), (313, 360), (313, 345)], strokeColor=ORANGE, strokeWidth=3))

    # --- Level 2: $98 vs $2 ---
    d.add(create_text(130, 325, ["98%"]))
    d.add(create_text(313, 325, ["2%"]))
    
    # Line from $98 down to User Owns (Level 5)
    d.add(Line(130, 315, 130, 120, strokeColor=ORANGE, strokeWidth=3))
    
    # Line from $2 down
    d.add(Line(313, 315, 313, 280, strokeColor=ORANGE, strokeWidth=3))
    
    # Split from $2: Left to 235 (Bags), Right to 403 ($1 Split)
    d.add(PolyLine([(235, 260), (235, 280), (403, 280), (403, 260)], strokeColor=ORANGE, strokeWidth=3))
    
    # --- Level 3: $1 split (Right) ---
    # Bags.fm moved to Level 5
    d.add(create_text(403, 240, ["$1.00"]))
    
    # Line for Bags.fm down to Level 5
    d.add(Line(235, 260, 235, 120, strokeColor=ORANGE, strokeWidth=3))
    
    # Line from Creator down
    d.add(Line(403, 230, 403, 195, strokeColor=ORANGE, strokeWidth=3))
    
    # Split from Creator: Left to 330 (50%), Right to 438 (50%)
    d.add(PolyLine([(330, 178), (330, 195), (438, 195), (438, 178)], strokeColor=ORANGE, strokeWidth=3))
    
    # --- Level 4: 50% / 50% ---
    d.add(create_text(330, 160, ["40%"]))
    d.add(create_text(438, 160, ["60%"]))
    
    # Lines down
    d.add(Line(330, 152, 330, 120, strokeColor=ORANGE, strokeWidth=3))
    
    # Right side 50% line down to split point
    d.add(Line(438, 152, 438, 135, strokeColor=ORANGE, strokeWidth=3))
    
    # Split from Right 50% (438): Left to 393 (AMM), Right to 483 (Dividends)
    d.add(PolyLine([(393, 115), (393, 135), (483, 135), (483, 115)], strokeColor=ORANGE, strokeWidth=3))
    
    # --- Level 5: Final Output ---
    d.add(create_text(130, 100, ["User Owns", "$98 GEOINT"]))
    
    d.add(create_text(235, 100, ["$1.00", "Bags.fm"]))
    
    d.add(create_text(330, 100, ["$0.40", "Creator"]))
    
    d.add(create_text(393, 100, ["$0.25", "AMM"]))
    d.add(create_text(483, 100, ["$0.35", "Dividends"]))

    # Center the diagram by shifting right (User reported left skew)
    # Wrap all current elements in a Group with translation
    centering_shift = 50
    
    content_group = Group(transform=(1,0,0,1, centering_shift, 0))
    content_group.contents = d.contents
    d.contents = [content_group]

    # Scale Chart to fit on page
    d.scale(0.80, 0.80)
    d.width = d.width * 0.80
    d.height = d.height * 0.80

    class LinkedChart(Flowable):
        def __init__(self, drawing):
            Flowable.__init__(self)
            self.drawing = drawing
            self.width = drawing.width
            self.height = drawing.height
        
        def draw(self):
            renderPDF.draw(self.drawing, self.canv, 0, 0)
            
            # Add Link over Bags.fm (Updated Coords - Scaled & Shifted)
            scale = 0.80
            shift_x = 50
            
            font_size = 13 * scale
            text = "Bags.fm"
            
            # Original coords: x=235, y=100 (Updated from 195)
            # Apply shift then scale
            x_c = (235 + shift_x) * scale
            y_b = (100 * scale) - (font_size * 1.2)
            
            w = stringWidth(text, FONT, 13) * scale # approx width scaled
            h = font_size
            
            # Rect: (left, bottom, right, top)
            rect = (x_c - w/2 - 2, y_b - 2, x_c + w/2 + 2, y_b + h + 2)
            self.canv.linkURL("https://geoint.world/ca", rect, relative=1)

    return LinkedChart(d)



# Disclaimer Text
DISCLAIMER_TEXT = """Legal Disclaimer: Nothing in this White Paper is an offer to sell, or the solicitation of an offer to buy, any tokens. GEOINT is publishing this White Paper solely to receive feedback and comments from the public. If and when GEOINT offers for sale any tokens (or a Simple Agreement for Future Tokens), it will do so through definitive offering documents, including a disclosure document and risk factors. Those definitive documents also are expected to include an updated version of this White Paper, which may differ significantly from the current version.

Nothing in this White Paper should be treated or read as a guarantee or promise of how GEOINT's business or the tokens will develop or of the utility or value of the tokens. This White Paper outlines current plans, which could change at its discretion, and the success of which will depend on many factors outside GEOINT's control, including market-based factors and factors within the data and cryptocurrency industries, among others. Any statements about future events are based solely on GEOINT's analysis of the issues described in this White Paper. That analysis may prove to be incorrect."""

def draw_background(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(THEME_BG)
    canvas.rect(0, 0, LETTER[0], LETTER[1], fill=1, stroke=0)
    
    # Add Page Number
    page_num = canvas.getPageNumber()
    text = "%d" % page_num
    canvas.setFont(THEME_FONT, 14)
    canvas.setFillColor(THEME_ORANGE)
    canvas.drawCentredString(LETTER[0]/2, 30, text)
    
    # Add Copyright Tag Only on Page 4
    if page_num == 4:
        canvas.setFont(THEME_FONT, 14)
        text = "© 2026 GEOINT.WORLD"
        canvas.drawCentredString(LETTER[0]/2, 70, text)
        
        # Link Copyright
        width = stringWidth(text, THEME_FONT, 14)
        # Rect: (left, bottom, right, top) - y=70 is baseline
        rect = ((LETTER[0] - width) / 2, 70, (LETTER[0] + width) / 2, 84)
        canvas.linkURL("https://geoint.world", rect)
        
        canvas.drawCentredString(LETTER[0]/2, 50, "CONTACT@GEOINT.WORLD")

    # Add Grain Overlay based on Page Number (grain1 - grain4)
    canvas.saveState()
    try:
        grain_path = r"c:\xampp\htdocs\geoint\html\scripts\grain%d.png" % page_num
        # Draw grain image sized to fit page
        canvas.drawImage(grain_path, 0, 0, width=LETTER[0], height=LETTER[1], mask='auto')
    except:
        pass
    canvas.restoreState()

    canvas.restoreState()

def draw_first_page(canvas, doc):
    draw_background(canvas, doc)
    


    # Enable Outline View by default
    canvas.showOutline()
    # Reference dot removed - period is now centered




class Bookmark(Flowable):
    def __init__(self, title):
        Flowable.__init__(self)
        self.title = title
        self.width = 0
        self.height = 0

    def draw(self):
        key = self.title
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(self.title, key, level=0, closed=True)

def create_whitepaper():
    doc = SimpleDocTemplate(r"c:\xampp\htdocs\geoint\html\whitepaper.pdf", pagesize=LETTER,
                            rightMargin=72, leftMargin=72,
                            topMargin=72, bottomMargin=72,
                            title="WHITEPAPER")
    
    styles = getSampleStyleSheet()
    
    # Custom Styles - Dark Theme
    styles.add(ParagraphStyle(name='CustomTitle', 
                              parent=styles['Heading1'], 
                              fontName=THEME_FONT,
                              fontSize=42, 
                              spaceAfter=20, 
                              alignment=1, 
                              textColor=THEME_ORANGE))
    
    # Split title styles for period-centered alignment
    styles.add(ParagraphStyle(name='TitleLeft', 
                              parent=styles['Heading1'], 
                              fontName=THEME_FONT,
                              fontSize=42, 
                              spaceAfter=0, 
                              alignment=2,  # Right align
                              textColor=THEME_ORANGE))
    
    styles.add(ParagraphStyle(name='TitleRight', 
                              parent=styles['Heading1'], 
                              fontName=THEME_FONT,
                              fontSize=42, 
                              spaceAfter=0, 
                              alignment=0,  # Left align
                              textColor=THEME_ORANGE))
                              
    styles.add(ParagraphStyle(name='CustomSubtitle', 
                              parent=styles['Heading2'], 
                              fontName=THEME_FONT,
                              fontSize=16, 
                              spaceAfter=48, 
                              alignment=1, 
                              textColor=THEME_ORANGE))
                              
    styles.add(ParagraphStyle(name='Ticker', 
                              parent=styles['Heading2'], 
                              fontName=THEME_FONT,
                              fontSize=18, 
                              spaceBefore=0,
                              spaceAfter=0, 
                              alignment=1, 
                              textColor=THEME_BG))
                              
    styles.add(ParagraphStyle(name='CustomSectionHeader', 
                              parent=styles['Heading2'], 
                              fontName=THEME_FONT,
                              fontSize=28, 
                              spaceBefore=0, 
                              spaceAfter=0, 
                              alignment=1,
                              textColor=THEME_ORANGE))
                              
    styles.add(ParagraphStyle(name='BodyTextCustom', 
                              parent=styles['BodyText'], 
                              fontName=THEME_FONT,
                              fontSize=11, 
                              leading=15, 
                              spaceAfter=12,
                              textColor=THEME_ORANGE))
    
    styles.add(ParagraphStyle(name='ListItem', 
                              parent=styles['BodyText'], 
                              fontName=THEME_FONT,
                              fontSize=11, 
                              leading=20, 
                              leftIndent=50,
                              spaceAfter=16,
                              textColor=THEME_ORANGE))
    
    styles.add(ParagraphStyle(name='ListNumber', 
                              parent=styles['BodyText'], 
                              fontName=THEME_FONT,
                              fontSize=20, 
                              leading=24, 
                              leftIndent=0,
                              spaceBefore=16,
                              spaceAfter=4,
                              textColor=THEME_ORANGE))
                              
    styles.add(ParagraphStyle(name='Footer', 
                              parent=styles['Normal'], 
                              fontName=THEME_FONT,
                              fontSize=14, 
                              alignment=1, 
                              textColor=THEME_ORANGE))

    styles.add(ParagraphStyle(name='LegalDisclaimer', 
                              parent=styles['Normal'], 
                              fontName=THEME_FONT,
                              fontSize=8, 
                              leading=10,
                              alignment=0, 
                              textColor=colors.gray,
                              spaceBefore=24))

    data = [
        ["Creator", "$0.40"],
        ["AMM", "$0.25"],
        ["Dividends", "$0.35"]
    ]

    def create_header(text):
        p = Paragraph(text, styles['CustomSectionHeader'])
        t = Table([[p]], colWidths=[6.5*inch])
        t.setStyle(TableStyle([
            ('LINEBELOW', (0, 0), (-1, -1), 1, THEME_ORANGE),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 19),
        ]))
        t.hAlign = 'CENTER'
        t.spaceBefore = 10
        t.spaceAfter = 8
        return t


    content = []

    # --- Title Page ---
    content.append(Spacer(1, 0.4 * inch))
    im = Image(r"c:\xampp\htdocs\geoint\html\scripts\globe.png", width=2.62*inch, height=2.62*inch)
    im.hAlign = 'CENTER'
    content.append(im)
    content.append(Spacer(1, 0.3 * inch))
    
    # Create title with period centered using a three-cell table
    title_left = Paragraph('<a href="https://geoint.world" color="#ff6800">GEOINT</a>', styles['TitleLeft'])
    title_period = Paragraph('<a href="https://geoint.world" color="#ff6800">.</a>', styles['CustomTitle'])
    title_right = Paragraph('<a href="https://geoint.world" color="#ff6800">WORLD</a>', styles['TitleRight'])
    title_table = Table([[title_left, title_period, title_right]], colWidths=[3.0*inch, 0.5*inch, 3.0*inch])
    title_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (0, 0), 'RIGHT'),
        ('ALIGN', (1, 0), (1, 0), 'CENTER'),
        ('ALIGN', (2, 0), (2, 0), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
    ]))
    title_table.hAlign = 'CENTER'
    content.append(title_table)
    content.append(Spacer(1, 0.265 * inch))  # Space before ticker
    
    # Create ticker as a Table with orange background
    ticker_para = Paragraph('<a href="https://geoint.world/ca" color="black">$GEOINT | BAGS.FM</a>', styles['Ticker'])
    ticker_table = Table([[ticker_para]], colWidths=[6.5*inch])
    ticker_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), THEME_ORANGE),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), -1),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    ticker_table.hAlign = 'CENTER'
    content.append(ticker_table)
    content.append(Spacer(1, 0.15 * inch))
    # Move logos up by reducing subtitle spacing
    subtitle_style = ParagraphStyle('SubtitleNoPad', parent=styles['CustomSubtitle'], spaceAfter=0)
    content.append(Paragraph("Geospatial Intelligence on Solana", subtitle_style))
    
    # Add logos side by side below subtitle
    # Create LinkedImage class for clickable logos
    class LinkedImage(Flowable):
        def __init__(self, img_path, width, height, url, y_offset=0):
            Flowable.__init__(self)
            self.img_path = img_path
            self.img_width = width
            self.img_height = height
            self.url = url
            self.width = width
            self.height = height
            self.y_offset = y_offset
        
        def draw(self):
            self.canv.drawImage(self.img_path, 0, self.y_offset, width=self.img_width, height=self.img_height, mask='auto')
            rect = (0, self.y_offset, self.img_width, self.img_height + self.y_offset)
            self.canv.linkURL(self.url, rect, relative=1)
    
    github_logo = LinkedImage(r"c:\xampp\htdocs\geoint\html\scripts\github_logo.png", 0.51*inch, 0.51*inch, "https://github.com/geointdotworld", y_offset=-4)
    x_logo = LinkedImage(r"c:\xampp\htdocs\geoint\html\scripts\x_logo.png", 0.36*inch, 0.37*inch, "https://x.com/geointdotworld", y_offset=-2)
    tele_logo = LinkedImage(r"c:\xampp\htdocs\geoint\html\scripts\tele_logo.png", 0.72*inch, 0.72*inch, "https://t.me/geointdotworld")
    
    logo_table = Table([[github_logo, x_logo, tele_logo]], colWidths=[1.0*inch, 1.0*inch, 1.0*inch])
    logo_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    logo_table.hAlign = 'CENTER'
    content.append(logo_table)
    
    content.append(Spacer(1, 1.0 * inch))
    # content.append(Paragraph(f"Generated: {datetime.now().strftime('%B %d, %Y')}", styles['Footer']))
    content.append(Paragraph(DISCLAIMER_TEXT, styles['LegalDisclaimer']))
    content.append(PageBreak())

    # --- About ---
    content.append(Bookmark("About"))
    content.append(create_header("About"))
    content.append(Paragraph("GEOINT.WORLD is a platform for visualizing real-time GEOINT/OSINT data sources i.e. news, aviation, marine, and satellite feeds. GEOINT permanently archives data into the Solana blockchain and presents multi-source intelligence on a unified web-based map interface. GEOINT.WORLD is the poor mans Palantir, providing access to geospatial intelligence as an alternative to enterprise software.", styles['BodyTextCustom']))
    
    content.append(Spacer(1, 0.25 * inch))

    # --- Why $GEOINT? ---
    content.append(Bookmark("Why $GEOINT?"))
    content.append(create_header("Why $GEOINT?"))
    content.append(Paragraph("Situation monitoring faces two core problems: data is scattered across multiple sources, and historical data disappears when deleted from original servers.", styles['BodyTextCustom']))
    content.append(Paragraph("1. Centralized Data", styles['ListNumber']))
    content.append(Paragraph("As data becomes more accessible to the masses, OSINT analysts and situation monitors are forced to juggle multiple data streams simultaneously. Patterns and information get missed because the data is fragmented. GEOINT.WORLD centralizes these streams into one searchable interface.", styles['ListItem']))
    
    content.append(Paragraph("2. Permanent Records", styles['ListNumber']))
    content.append(Paragraph("Real-time data streams provide no historical access. Flight tracking, social posts, and news headlines disappear or change. $GEOINT makes it possible to inscribe datapoints onto Solana, creating permanent timestamped records. Historical queries across any timeframe or location return verifiable results from immutable on-chain storage.", styles['ListItem']))
    
    content.append(PageBreak())
    content.append(Paragraph("3. Holder Incentive Mechanisms", styles['ListNumber']))
    content.append(Paragraph("$GEOINT rewards token holders through deflationary burns and automated dividend distribution. The inscription system requires token burns that reduce circulating supply, create permanent on-chain records, and generate trading volume. Additionally, 60% of the fees on every swap are distributed automatically to holders in SOL, producing passive yield for holders.", styles['ListItem']))
    
    content.append(Spacer(1, 0.1 * inch))
    
    # --- Tokenomics ---
    content.append(Bookmark("Tokenomics"))
    content.append(create_header("Tokenomics"))
    content.append(Paragraph("GEOINT incentivizes long-term holding through two mechanisms: token burns via inscriptions and automated dividend distribution.", styles['BodyTextCustom']))
    
    content.append(Paragraph("1. Burn Based Inscriptions", styles['ListNumber']))
    content.append(Paragraph("Inscriptions to the Solana blockchain require users to approve a transaction valued at $3 USD. The transaction automatically swaps SOL to $GEOINT, burns the tokens, and inscribes data to the blockchain using Solana's native memo program after the burn transaction. This creates permanent on-chain records while reducing token supply and generating volume for swap fees.", styles['ListItem']))
    
    content.append(Paragraph("2. Dividend Distribution", styles['ListNumber']))
    content.append(Paragraph("The protocol allocates 35% of swap fees to token holders, distributing automatically in SOL upon reaching the $1,000 USD threshold. Payouts are proportional to each holder's ownership percentage. The remaining 65% supports development and operations. No manual claiming required.", styles['ListItem']))
    
    content.append(Paragraph("3. Self Sustaining Volume", styles['ListNumber']))
    content.append(Paragraph("25% of $GEOINT's swap fees fund an AMM bot that continuously trades $GEOINT, maintaining liquidity and preventing crashes when organic volume dries up. This activity shows up as volume on DEX platforms, attracting real traders while generating more swap fees, all of which flow back to holders as dividends.", styles['ListItem']))
    
    content.append(Spacer(1, 0.05 * inch))
    content.append(create_tokenomics_chart())
    content.append(Spacer(1, 0.2 * inch))




    # Build PDF with Background
    doc.build(content, onFirstPage=draw_first_page, onLaterPages=draw_background)
    print("PDF Generated Successfully: whitepaper.pdf")

if __name__ == "__main__":
    create_whitepaper()
