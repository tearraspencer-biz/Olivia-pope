import { createClient } from '@supabase/supabase-js'
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from 'docx'
import PDFDocument from 'pdfkit'
import type { MeetingIntelligence, TearraCommitment } from './meeting-intel.js'

// ── Brand ─────────────────────────────────────────────────────────────────────

const PURPLE = '#6B21A8'
const GOLD = '#D4A017'
const PURPLE_HEX = '6B21A8' // docx uses hex without #
const GOLD_HEX = 'D4A017'
const MUTED_HEX = '8B8BA0'

// ── Storage client ────────────────────────────────────────────────────────────

const storageClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function uploadToStorage(
  buffer: Buffer,
  storagePath: string,
  contentType: string
): Promise<string> {
  const { error } = await storageClient.storage
    .from('meeting-exports')
    .upload(storagePath, buffer, { contentType, upsert: true })

  if (error) throw new Error(`Storage upload failed for ${storagePath}: ${error.message}`)

  const { data } = await storageClient.storage
    .from('meeting-exports')
    .createSignedUrl(storagePath, 315_360_000) // ~10 years

  if (!data?.signedUrl) throw new Error(`Failed to get signed URL for ${storagePath}`)
  return data.signedUrl
}

// ── PDF helpers ───────────────────────────────────────────────────────────────

function buildPdf(
  generator: (doc: PDFKit.PDFDocument) => void
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER', bufferPages: true })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    generator(doc)
    doc.end()
  })
}

function pdfPageHeader(
  doc: PDFKit.PDFDocument,
  subtitle: string,
  title: string,
  date: string,
  attendees: string,
  typeLabel: string
) {
  doc
    .fontSize(8)
    .fillColor(MUTED_HEX.replace(/^/, '#'))
    .font('Helvetica')
    .text('IMPACTFUL FINANCIAL SOLUTIONS', 50, 50)

  doc.moveTo(50, 64).lineTo(562, 64).strokeColor(PURPLE).lineWidth(2).stroke()

  doc
    .fontSize(7)
    .fillColor(PURPLE)
    .font('Helvetica-Bold')
    .text(subtitle.toUpperCase(), 50, 72)

  doc.moveTo(50, 84).lineTo(562, 84).strokeColor(GOLD).lineWidth(0.75).stroke()

  doc.fontSize(16).fillColor('#111111').font('Helvetica-Bold').text(title, 50, 92, { width: 512 })

  const yAfterTitle = doc.y + 4
  doc
    .fontSize(9)
    .fillColor('#555555')
    .font('Helvetica')
    .text(`${date}  ·  ${typeLabel}  ·  Attendees: ${attendees}`, 50, yAfterTitle, { width: 512 })

  doc.moveTo(50, doc.y + 6).lineTo(562, doc.y + 6).strokeColor(GOLD).lineWidth(0.5).stroke()
  doc.moveDown(1.2)
}

function pdfSection(doc: PDFKit.PDFDocument, heading: string) {
  doc.moveDown(0.4)
  doc.fontSize(8).fillColor(PURPLE).font('Helvetica-Bold').text(heading.toUpperCase())
  doc
    .moveTo(50, doc.y + 1)
    .lineTo(562, doc.y + 1)
    .strokeColor('#DDDDDD')
    .lineWidth(0.5)
    .stroke()
  doc.moveDown(0.4)
}

function pdfBody(doc: PDFKit.PDFDocument, text: string) {
  doc.fontSize(10).fillColor('#222222').font('Helvetica').text(text, { paragraphGap: 3 })
}

function pdfBullets(doc: PDFKit.PDFDocument, items: string[]) {
  doc.fontSize(10).fillColor('#222222').font('Helvetica')
  for (const item of items) {
    doc.text(`• ${item}`, { indent: 12, paragraphGap: 3 })
  }
  doc.moveDown(0.3)
}

function pdfSubLabel(doc: PDFKit.PDFDocument, text: string) {
  doc.fontSize(8).fillColor(PURPLE).font('Helvetica-Bold').text(text)
}

// ── PDF — Internal ────────────────────────────────────────────────────────────

export async function generateInternalPdf(
  meetingId: string,
  title: string,
  date: string,
  attendees: string,
  intel: MeetingIntelligence,
  businessLens: string,
  fathomSummary: string | null,
  fathomActionItems: string | null,
  tearraCommitments?: TearraCommitment[]
): Promise<string> {
  const buffer = await buildPdf((doc) => {
    pdfPageHeader(doc, 'Meeting Intelligence Report — Internal', title, date, attendees, intel.overview.meeting_type_label)

    // Overview
    pdfSection(doc, 'Meeting Overview')
    pdfBody(doc, `Purpose: ${intel.overview.purpose}`)
    pdfBody(doc, `Outcome: ${intel.overview.outcome_summary}`)

    // Decisions
    if (intel.decisions.length > 0) {
      pdfSection(doc, 'Decisions Made')
      pdfBullets(doc, intel.decisions)
    }

    // Action Items
    if (intel.action_items.length > 0) {
      pdfSection(doc, 'Action Items')
      for (const item of intel.action_items) {
        const deadline = item.deadline ? `  |  Due: ${item.deadline}` : ''
        doc.fontSize(10).fillColor('#111111').font('Helvetica-Bold').text(item.action, { indent: 12 })
        doc
          .fontSize(9)
          .fillColor('#555555')
          .font('Helvetica')
          .text(`Owner: ${item.owner}  |  Priority: ${item.priority.toUpperCase()}${deadline}`, {
            indent: 12,
            paragraphGap: 5,
          })
      }
      doc.moveDown(0.3)
    }

    // Next Steps
    if (intel.next_steps.length > 0) {
      pdfSection(doc, 'Next Steps')
      intel.next_steps.forEach((step, i) => pdfBody(doc, `${i + 1}. ${step}`))
    }

    // Client Intel
    if (intel.client_intel.applicable) {
      pdfSection(doc, 'Client Intelligence')
      if (intel.client_intel.situation) pdfBody(doc, `Situation: ${intel.client_intel.situation}`)
      if (intel.client_intel.needs.length > 0) {
        pdfSubLabel(doc, 'Needs')
        pdfBullets(doc, intel.client_intel.needs)
      }
      if (intel.client_intel.buying_signals.length > 0) {
        pdfSubLabel(doc, 'Buying Signals')
        pdfBullets(doc, intel.client_intel.buying_signals)
      }
      if (intel.client_intel.objections.length > 0) {
        pdfSubLabel(doc, 'Objections')
        pdfBullets(doc, intel.client_intel.objections)
      }
      if (intel.client_intel.concerns.length > 0) {
        pdfSubLabel(doc, 'Concerns')
        pdfBullets(doc, intel.client_intel.concerns)
      }
      if (intel.client_intel.timeline_signals) pdfBody(doc, `Timeline: ${intel.client_intel.timeline_signals}`)
      if (intel.client_intel.budget_signals) pdfBody(doc, `Budget: ${intel.client_intel.budget_signals}`)
    }

    // Ideas
    if (intel.ideas_and_opportunities.length > 0) {
      pdfSection(doc, 'Ideas & Opportunities')
      pdfBullets(doc, intel.ideas_and_opportunities)
    }

    // Follow-up
    if (intel.follow_up_required.length > 0) {
      pdfSection(doc, 'Follow-Up Required')
      for (const fu of intel.follow_up_required) {
        doc.fontSize(10).fillColor('#111111').font('Helvetica-Bold').text(fu.action, { indent: 12 })
        doc
          .fontSize(9)
          .fillColor('#555555')
          .font('Helvetica')
          .text(`For: ${fu.recipient}  |  ${fu.urgency.replace(/_/g, ' ').toUpperCase()}`, {
            indent: 12,
            paragraphGap: 5,
          })
      }
      doc.moveDown(0.3)
    }

    // My Commitments
    if (tearraCommitments && tearraCommitments.length > 0) {
      pdfSection(doc, 'My Commitments')
      for (const c of tearraCommitments) {
        const label = `[${c.urgency.replace(/_/g, ' ').toUpperCase()}]`
        doc.fontSize(10).fillColor('#111111').font('Helvetica-Bold').text(`${label}  ${c.commitment}`, { indent: 12 })
        if (c.deadline) {
          doc.fontSize(9).fillColor('#555555').font('Helvetica').text(`Due: ${c.deadline}`, { indent: 12, paragraphGap: 5 })
        } else {
          doc.moveDown(0.3)
        }
      }
      doc.moveDown(0.3)
    }

    // Outcome
    pdfSection(doc, 'Meeting Outcome')
    pdfBody(doc, intel.meeting_outcome.overall_assessment)
    if (intel.meeting_outcome.moved_forward.length > 0) {
      pdfSubLabel(doc, 'Advanced')
      pdfBullets(doc, intel.meeting_outcome.moved_forward)
    }
    if (intel.meeting_outcome.unresolved.length > 0) {
      pdfSubLabel(doc, 'Still Open')
      doc.fontSize(10).fillColor('#EF4444').font('Helvetica')
      for (const item of intel.meeting_outcome.unresolved) {
        doc.text(`• ${item}`, { indent: 12, paragraphGap: 3 })
      }
      doc.moveDown(0.3)
    }

    // Business Lens — new page
    doc.addPage()
    pdfPageHeader(doc, 'Meeting Intelligence Report — Internal (continued)', title, date, attendees, intel.overview.meeting_type_label)
    pdfSection(doc, '8-Layer Business Lens')
    doc.fontSize(10).fillColor('#222222').font('Helvetica').text(businessLens, { paragraphGap: 4 })

    // Fathom raw data — new page if present
    if (fathomSummary || fathomActionItems) {
      doc.addPage()
      pdfPageHeader(doc, 'Meeting Intelligence Report — Fathom Source Data', title, date, attendees, intel.overview.meeting_type_label)
      if (fathomSummary) {
        pdfSection(doc, 'Fathom Summary')
        pdfBody(doc, fathomSummary)
      }
      if (fathomActionItems) {
        pdfSection(doc, 'Fathom Action Items')
        pdfBody(doc, fathomActionItems)
      }
    }

    // Footers
    const range = doc.bufferedPageRange()
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i)
      doc
        .fontSize(8)
        .fillColor('#8B8BA0')
        .font('Helvetica')
        .text(
          `Impactful Financial Solutions  |  Confidential — Internal Use Only  |  Page ${i + 1} of ${range.count}`,
          50,
          doc.page.height - 35,
          { align: 'center', width: 512 }
        )
    }
  })

  return uploadToStorage(buffer, `meetings/${meetingId}/internal.pdf`, 'application/pdf')
}

// ── PDF — Client ──────────────────────────────────────────────────────────────

export async function generateClientPdf(
  meetingId: string,
  title: string,
  date: string,
  attendees: string,
  intel: MeetingIntelligence
): Promise<string> {
  const buffer = await buildPdf((doc) => {
    pdfPageHeader(doc, 'Meeting Summary', title, date, attendees, intel.overview.meeting_type_label)

    // Summary
    pdfSection(doc, 'Meeting Summary')
    pdfBody(doc, intel.overview.outcome_summary)
    if (intel.meeting_outcome.overall_assessment) {
      doc.moveDown(0.3)
      pdfBody(doc, intel.meeting_outcome.overall_assessment)
    }

    // Key Decisions
    if (intel.decisions.length > 0) {
      pdfSection(doc, 'Key Decisions')
      pdfBullets(doc, intel.decisions)
    }

    // Action Items — clean, no priority labels
    if (intel.action_items.length > 0) {
      pdfSection(doc, 'Action Items')
      for (const item of intel.action_items) {
        const deadline = item.deadline ? `  ·  ${item.deadline}` : ''
        doc.fontSize(10).fillColor('#111111').font('Helvetica-Bold').text(item.action, { indent: 12 })
        doc
          .fontSize(9)
          .fillColor('#555555')
          .font('Helvetica')
          .text(`${item.owner}${deadline}`, { indent: 12, paragraphGap: 5 })
      }
      doc.moveDown(0.3)
    }

    // Next Steps
    if (intel.next_steps.length > 0) {
      pdfSection(doc, 'Next Steps')
      intel.next_steps.forEach((step, i) => pdfBody(doc, `${i + 1}. ${step}`))
    }

    // Closing
    doc.moveDown(2)
    doc.moveTo(50, doc.y).lineTo(562, doc.y).strokeColor(GOLD).lineWidth(1).stroke()
    doc.moveDown(1.2)
    doc
      .fontSize(10)
      .fillColor('#555555')
      .font('Helvetica-Oblique')
      .text('Thank you for your time. We look forward to the next steps.', { align: 'center' })

    // Footer
    const range = doc.bufferedPageRange()
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i)
      doc
        .fontSize(8)
        .fillColor('#8B8BA0')
        .font('Helvetica')
        .text(
          'Impactful Financial Solutions',
          50,
          doc.page.height - 35,
          { align: 'center', width: 512 }
        )
    }
  })

  return uploadToStorage(buffer, `meetings/${meetingId}/client.pdf`, 'application/pdf')
}

// ── DOCX helpers ──────────────────────────────────────────────────────────────

function docxHeading(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, color: PURPLE_HEX, size: 20 })],
    spacing: { before: 240, after: 80 },
  })
}

function docxBody(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: 20 })],
    spacing: { after: 60 },
  })
}

function docxBullet(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: 20 })],
    bullet: { level: 0 },
    spacing: { after: 40 },
  })
}

function docxSubLabel(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: text.toUpperCase(), bold: true, color: PURPLE_HEX, size: 16 })],
    spacing: { before: 120, after: 40 },
  })
}

function docxHeader(subtitle: string, title: string, date: string, attendees: string, typeLabel: string): Paragraph[] {
  return [
    new Paragraph({
      children: [new TextRun({ text: 'IMPACTFUL FINANCIAL SOLUTIONS', bold: true, color: MUTED_HEX, size: 16 })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: subtitle.toUpperCase(), bold: true, color: PURPLE_HEX, size: 16 })],
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 36 })],
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `${date}  ·  ${typeLabel}  ·  Attendees: ${attendees}`, color: '555555', size: 18 })],
      spacing: { after: 200 },
    }),
  ]
}

function docxActionItemTable(items: Array<{ action: string; owner: string; deadline: string | null; priority: string }>): Table {
  const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const headerRow = new TableRow({
    children: [
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: 'ACTION', bold: true, color: PURPLE_HEX, size: 18 })] })],
        width: { size: 50, type: WidthType.PERCENTAGE },
        borders: { top: NO_BORDER, bottom: { style: BorderStyle.SINGLE, size: 4, color: GOLD_HEX }, left: NO_BORDER, right: NO_BORDER },
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: 'OWNER', bold: true, color: PURPLE_HEX, size: 18 })] })],
        width: { size: 20, type: WidthType.PERCENTAGE },
        borders: { top: NO_BORDER, bottom: { style: BorderStyle.SINGLE, size: 4, color: GOLD_HEX }, left: NO_BORDER, right: NO_BORDER },
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: 'DEADLINE', bold: true, color: PURPLE_HEX, size: 18 })] })],
        width: { size: 20, type: WidthType.PERCENTAGE },
        borders: { top: NO_BORDER, bottom: { style: BorderStyle.SINGLE, size: 4, color: GOLD_HEX }, left: NO_BORDER, right: NO_BORDER },
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: 'PRIORITY', bold: true, color: PURPLE_HEX, size: 18 })] })],
        width: { size: 10, type: WidthType.PERCENTAGE },
        borders: { top: NO_BORDER, bottom: { style: BorderStyle.SINGLE, size: 4, color: GOLD_HEX }, left: NO_BORDER, right: NO_BORDER },
      }),
    ],
  })

  const dataRows = items.map(
    (item) =>
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: item.action, size: 18 })] })],
            borders: { top: NO_BORDER, bottom: { style: BorderStyle.SINGLE, size: 1, color: 'EEEEEE' }, left: NO_BORDER, right: NO_BORDER },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: item.owner, size: 18 })] })],
            borders: { top: NO_BORDER, bottom: { style: BorderStyle.SINGLE, size: 1, color: 'EEEEEE' }, left: NO_BORDER, right: NO_BORDER },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: item.deadline ?? '—', size: 18 })] })],
            borders: { top: NO_BORDER, bottom: { style: BorderStyle.SINGLE, size: 1, color: 'EEEEEE' }, left: NO_BORDER, right: NO_BORDER },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: item.priority.toUpperCase(), size: 18, color: item.priority === 'high' ? GOLD_HEX : MUTED_HEX })] })],
            borders: { top: NO_BORDER, bottom: { style: BorderStyle.SINGLE, size: 1, color: 'EEEEEE' }, left: NO_BORDER, right: NO_BORDER },
          }),
        ],
      })
  )

  return new Table({ rows: [headerRow, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } })
}

// ── DOCX — Internal ───────────────────────────────────────────────────────────

export async function generateInternalDocx(
  meetingId: string,
  title: string,
  date: string,
  attendees: string,
  intel: MeetingIntelligence,
  businessLens: string,
  fathomSummary: string | null,
  fathomActionItems: string | null,
  tearraCommitments?: TearraCommitment[]
): Promise<string> {
  const children: (Paragraph | Table)[] = [
    ...docxHeader('Meeting Intelligence Report — Internal', title, date, attendees, intel.overview.meeting_type_label),

    docxHeading('Meeting Overview'),
    docxBody(`Purpose: ${intel.overview.purpose}`),
    docxBody(`Outcome: ${intel.overview.outcome_summary}`),
  ]

  if (intel.decisions.length > 0) {
    children.push(docxHeading('Decisions Made'))
    intel.decisions.forEach((d) => children.push(docxBullet(d)))
  }

  if (intel.action_items.length > 0) {
    children.push(docxHeading('Action Items'))
    children.push(docxActionItemTable(intel.action_items))
  }

  if (intel.next_steps.length > 0) {
    children.push(docxHeading('Next Steps'))
    intel.next_steps.forEach((s, i) => children.push(docxBody(`${i + 1}. ${s}`)))
  }

  if (intel.client_intel.applicable) {
    children.push(docxHeading('Client Intelligence'))
    if (intel.client_intel.situation) children.push(docxBody(`Situation: ${intel.client_intel.situation}`))
    if (intel.client_intel.needs.length > 0) {
      children.push(docxSubLabel('Needs'))
      intel.client_intel.needs.forEach((n) => children.push(docxBullet(n)))
    }
    if (intel.client_intel.buying_signals.length > 0) {
      children.push(docxSubLabel('Buying Signals'))
      intel.client_intel.buying_signals.forEach((s) => children.push(docxBullet(s)))
    }
    if (intel.client_intel.objections.length > 0) {
      children.push(docxSubLabel('Objections'))
      intel.client_intel.objections.forEach((o) => children.push(docxBullet(o)))
    }
    if (intel.client_intel.concerns.length > 0) {
      children.push(docxSubLabel('Concerns'))
      intel.client_intel.concerns.forEach((c) => children.push(docxBullet(c)))
    }
    if (intel.client_intel.timeline_signals) children.push(docxBody(`Timeline: ${intel.client_intel.timeline_signals}`))
    if (intel.client_intel.budget_signals) children.push(docxBody(`Budget: ${intel.client_intel.budget_signals}`))
  }

  if (intel.ideas_and_opportunities.length > 0) {
    children.push(docxHeading('Ideas & Opportunities'))
    intel.ideas_and_opportunities.forEach((i) => children.push(docxBullet(i)))
  }

  if (intel.follow_up_required.length > 0) {
    children.push(docxHeading('Follow-Up Required'))
    for (const fu of intel.follow_up_required) {
      children.push(new Paragraph({ children: [new TextRun({ text: fu.action, bold: true, size: 20 })], spacing: { after: 40 } }))
      children.push(docxBody(`For: ${fu.recipient}  ·  ${fu.urgency.replace(/_/g, ' ').toUpperCase()}`))
    }
  }

  if (tearraCommitments && tearraCommitments.length > 0) {
    children.push(docxHeading('My Commitments'))
    for (const c of tearraCommitments) {
      const label = `[${c.urgency.replace(/_/g, ' ').toUpperCase()}]`
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `${label}  `, bold: true, color: c.urgency === 'immediate' ? 'EF4444' : GOLD_HEX, size: 18 }),
          new TextRun({ text: c.commitment, bold: true, size: 20 }),
        ],
        spacing: { after: 40 },
      }))
      if (c.deadline) {
        children.push(docxBody(`Due: ${c.deadline}`))
      }
    }
  }

  children.push(docxHeading('Meeting Outcome'))
  children.push(docxBody(intel.meeting_outcome.overall_assessment))
  if (intel.meeting_outcome.moved_forward.length > 0) {
    children.push(docxSubLabel('Advanced'))
    intel.meeting_outcome.moved_forward.forEach((m) => children.push(docxBullet(m)))
  }
  if (intel.meeting_outcome.unresolved.length > 0) {
    children.push(docxSubLabel('Still Open'))
    intel.meeting_outcome.unresolved.forEach((u) =>
      children.push(new Paragraph({ children: [new TextRun({ text: `• ${u}`, color: 'EF4444', size: 20 })], spacing: { after: 40 } }))
    )
  }

  children.push(docxHeading('8-Layer Business Lens'))
  businessLens.split('\n').forEach((line) => children.push(docxBody(line)))

  if (fathomSummary) {
    children.push(docxHeading('Fathom Summary'))
    fathomSummary.split('\n').forEach((line) => children.push(docxBody(line)))
  }
  if (fathomActionItems) {
    children.push(docxHeading('Fathom Action Items'))
    fathomActionItems.split('\n').forEach((line) => children.push(docxBody(line)))
  }

  const doc = new Document({ sections: [{ children }] })
  const buffer = await Packer.toBuffer(doc)
  return uploadToStorage(
    buffer,
    `meetings/${meetingId}/internal.docx`,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
}

// ── DOCX — Client ─────────────────────────────────────────────────────────────

export async function generateClientDocx(
  meetingId: string,
  title: string,
  date: string,
  attendees: string,
  intel: MeetingIntelligence
): Promise<string> {
  const children: (Paragraph | Table)[] = [
    ...docxHeader('Meeting Summary', title, date, attendees, intel.overview.meeting_type_label),

    docxHeading('Meeting Summary'),
    docxBody(intel.overview.outcome_summary),
  ]

  if (intel.meeting_outcome.overall_assessment) {
    children.push(docxBody(intel.meeting_outcome.overall_assessment))
  }

  if (intel.decisions.length > 0) {
    children.push(docxHeading('Key Decisions'))
    intel.decisions.forEach((d) => children.push(docxBullet(d)))
  }

  if (intel.action_items.length > 0) {
    children.push(docxHeading('Action Items'))
    // Client version: owner + deadline only, no priority
    for (const item of intel.action_items) {
      children.push(new Paragraph({ children: [new TextRun({ text: item.action, bold: true, size: 20 })], spacing: { after: 40 } }))
      const deadline = item.deadline ? `  ·  ${item.deadline}` : ''
      children.push(docxBody(`${item.owner}${deadline}`))
    }
  }

  if (intel.next_steps.length > 0) {
    children.push(docxHeading('Next Steps'))
    intel.next_steps.forEach((s, i) => children.push(docxBody(`${i + 1}. ${s}`)))
  }

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: 'Thank you for your time. We look forward to the next steps.',
          italics: true,
          color: '555555',
          size: 20,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 400 },
    })
  )

  const doc = new Document({ sections: [{ children }] })
  const buffer = await Packer.toBuffer(doc)
  return uploadToStorage(
    buffer,
    `meetings/${meetingId}/client.docx`,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
}
