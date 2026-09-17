import { jsPDF } from 'jspdf';
import { Download, FileText, Share2 } from 'lucide-react';
import { useLanguage } from '../store/language';

interface ExportPDFProps {
  analysis: any;
}

export default function ExportPDF({ analysis }: ExportPDFProps) {
  const lang = useLanguage((s) => s.lang);

  const analysisIdStr = String(analysis?._id ?? 'C3787');
  const safeFileId = analysisIdStr.length >= 6 ? analysisIdStr.slice(-6) : 'report';
  const createdAtFormatted = analysis?.createdAt
    ? new Date(analysis.createdAt).toLocaleString('en-IN')
    : new Date().toLocaleString('en-IN');

  // Extract applicant name from consensus or supporting docs
  const nameResult = (analysis?.fieldResults ?? []).find(
    (r: any) => r.fieldKey === 'full_name' || r.fieldKey === 'name' || /name/i.test(r.label)
  );
  const applicantName = nameResult?.consensusValue || nameResult?.supportingDocs?.[0]?.value || 'Citizen Applicant';

  // Extract conflicting fields
  const conflictingFields = (analysis?.fieldResults ?? []).filter((r: any) =>
    ['outlier_detected', 'possible_variant', 'conflicting_evidence', 'incomplete_date_conflict', 'outliers_found', 'extraction_invalid'].includes(r.status)
  );

  // ── Standard Consensus Report PDF ─────────────────────────────────────────
  const handleExport = () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const margin = 16;
    const contentW = W - margin * 2;
    let y = 20;

    const addText = (text: string, size: number, bold = false, color: [number, number, number] = [15, 23, 42]) => {
      doc.setFontSize(size);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setTextColor(...color);
      const lines = doc.splitTextToSize(text, contentW);
      doc.text(lines, margin, y);
      y += lines.length * size * 0.4 + 2;
    };

    const addLine = () => {
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y, W - margin, y);
      y += 4;
    };

    const checkPage = (needed = 20) => {
      if (y + needed > 280) {
        doc.addPage();
        y = 20;
      }
    };

    // ── Header ────────────────────────────────────────────────────
    doc.setFillColor(228, 161, 66);
    doc.rect(0, 0, W, 14, 'F');
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('NIRDOSH VAULT — Consensus Identity Report', margin, 9);
    y = 22;

    addText(`Generated: ${createdAtFormatted}`, 9, false, [100, 116, 139]);
    addText(`Session reference: NV-${analysisIdStr.slice(-5).toUpperCase()}`, 9, false, [100, 116, 139]);
    y += 2;
    addLine();

    // ── Overall status ───────────────────────────────────────────
    const s = analysis?.summary ?? {};
    const conflictCount = s.conflictFieldsCount ?? 0;
    addText(`Overall Status: ${conflictCount > 0 ? 'Review Required' : 'Consistent'}`, 14, true, conflictCount > 0 ? [180, 83, 9] : [16, 120, 85]);
    addLine();

    // ── Summary ───────────────────────────────────────────────────
    addText('Summary', 13, true);
    addText(`• Comparable Fields Checked: ${s.comparableFieldsCount ?? 0}`, 10);
    addText(`• Consensus Established: ${s.consensusFieldsCount ?? 0}`, 10, false, [16, 185, 129]);
    addText(`• Conflicts Detected: ${conflictCount}`, 10, false, conflictCount > 0 ? [239, 68, 68] : [16, 185, 129]);
    
    if (analysis?.documentSpecificFields?.length > 0) {
      addText(`• Document-Specific Attributes: ${analysis.documentSpecificFields.length} recorded`, 10, false, [59, 130, 246]);
    }
    
    y += 2;
    addLine();

    // ── Field Results ─────────────────────────────────────────────
    addText('Field-by-Field Results', 13, true);
    for (const result of (analysis?.fieldResults ?? [])) {
      checkPage(18);
      const statusColor: Record<string, [number, number, number]> = {
        consistent: [16, 185, 129],
        possible_variant: [59, 130, 246],
        outlier_detected: [245, 158, 11],
        conflicting_evidence: [239, 68, 68],
        incomplete_date_conflict: [239, 68, 68],
        extraction_invalid: [217, 119, 6],
        extraction_uncertain: [249, 115, 22],
        not_comparable: [100, 116, 139],
        missing: [100, 116, 139],
      };
      const col = statusColor[result.status] ?? [100, 116, 139];
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(`${result.label}`, margin, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...col);
      doc.text(result.status.replace(/_/g, ' '), margin + 60, y);
      y += 5;
      if (result.consensusValue) {
        doc.setTextColor(100, 116, 139);
        doc.setFontSize(9);
        doc.text(`   Consensus value: ${result.consensusValue}`, margin, y);
        y += 5;
      }
      if (result.explanation) {
        doc.setTextColor(100, 116, 139);
        doc.setFontSize(8);
        const lines = doc.splitTextToSize(`   ${result.explanation}`, contentW - 5);
        doc.text(lines, margin, y);
        y += lines.length * 3.5 + 2;
      }
    }
    addLine();

    // ── Guidance ──────────────────────────────────────────────────
    if (analysis?.guidance?.length > 0) {
      checkPage(20);
      addText('Correction Guidance', 13, true);
      for (const g of analysis.guidance) {
        checkPage(18);
        if (g?.fieldLabel) addText(`${g.issueStatus?.toUpperCase() || 'INFO'} — ${g.fieldLabel}`, 10, true);
        if (g?.explanation) addText(g.explanation, 9, false, [100, 116, 139]);
        y += 2;
      }
      addLine();
    }

    // ── Checklist ─────────────────────────────────────────────────
    const eligible = (analysis?.checklist ?? []).filter((c: any) => c.readiness === 'uploaded');
    if (eligible.length > 0) {
      checkPage(20);
      addText('Document Checklists Ready', 13, true);
      for (const scheme of eligible) {
        checkPage(14);
        addText(`Required document types uploaded: ${scheme.schemeName}`, 10, true, [16, 185, 129]);
        addText(`   ${scheme.ministry}`, 8, false, [100, 116, 139]);
        y += 2;
      }
      addLine();
    }

    // ── Disclaimer ────────────────────────────────────────────────
    checkPage(20);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(148, 163, 184);
    const disclaimer = 'DISCLAIMER: This report is generated by the Nirdosh Vault prototype for informational purposes only. It shows document consistency and does not constitute legal proof of identity. The issuing authority for each document remains the source of legal truth. Do not share this report publicly. Only synthetic/sample documents should be used with this prototype.';
    const dlines = doc.splitTextToSize(disclaimer, contentW);
    doc.text(dlines, margin, y);

    doc.save(`nirdosh-vault-report-${safeFileId}.pdf`);
  };

  // ── Kendra Resolution Slip PDF (Single-Page, Operator-Facing) ───────────
  const handleExportKendraSlip = () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const margin = 14;
    const contentW = W - margin * 2;
    let y = 14;

    const addText = (text: string, size: number, bold = false, color: [number, number, number] = [15, 23, 42]) => {
      doc.setFontSize(size);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setTextColor(...color);
      const lines = doc.splitTextToSize(text, contentW);
      doc.text(lines, margin, y);
      y += lines.length * size * 0.38 + 2;
    };

    // Header Banner
    doc.setFillColor(15, 23, 42); // Navy 950
    doc.rect(0, 0, W, 18, 'F');
    doc.setFillColor(228, 161, 66); // Saffron accent stripe
    doc.rect(0, 17, W, 1.5, 'F');

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('NIRDOSH VAULT — KENDRA RESOLUTION SLIP', margin, 9);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(203, 213, 225);
    doc.text('Operator Assistance Brief for CSC / Aaple Sarkar Seva Kendra', margin, 14);

    y = 25;

    // Operator Routing Badge
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(margin, y, contentW, 16, 2, 2, 'FD');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('TO: Common Service Centre (CSC) / Aaple Sarkar Kendra Operator', margin + 4, y + 6);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text('RE: Pre-submission identity discrepancy report — Recommended correction procedure attached below.', margin + 4, y + 11);

    y += 22;

    // Applicant & Session Details Grid
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(`Applicant Name: ${applicantName}`, margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`Session Ref: NV-${analysisIdStr.slice(-5).toUpperCase()}`, W - margin - 50, y);
    y += 5;
    doc.text(`Generated: ${createdAtFormatted}`, margin, y);
    doc.text(`Active Language: ${lang.toUpperCase()}`, W - margin - 50, y);
    y += 5;

    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y, W - margin, y);
    y += 5;

    // Status Heading
    const conflictCount = conflictingFields.length;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    if (conflictCount > 0) {
      doc.setTextColor(180, 83, 9);
      doc.text(`Discrepancy Summary: ${conflictCount} Field Mismatch(es) Requiring Update`, margin, y);
    } else {
      doc.setTextColor(16, 120, 85);
      doc.text('Discrepancy Summary: All Uploaded Documents Agree', margin, y);
    }
    y += 6;

    // Conflicting Fields Table / Details
    if (conflictCount > 0) {
      for (const field of conflictingFields) {
        doc.setFillColor(254, 242, 242);
        doc.setDrawColor(254, 202, 202);
        doc.roundedRect(margin, y, contentW, 28, 2, 2, 'FD');

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(153, 27, 27);
        doc.text(`• Discrepancy Field: ${field.label || field.fieldKey}`, margin + 4, y + 5);

        // Consensus Value
        doc.setFontSize(8.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(15, 23, 42);
        const supportingText = field.supportingDocs?.map((d: any) => d.docTitle).join(', ') || 'Majority of documents';
        doc.text(`Consensus Value: "${field.consensusValue || 'Inconclusive'}" (Confirmed by: ${supportingText})`, margin + 6, y + 11);

        // Outlier Value
        const outlierText = field.outliers?.map((o: any) => `${o.docTitle}: "${o.value}"`).join('; ')
          || field.groups?.map((g: any) => `${g.documents?.map((d: any) => d.docTitle).join('/')}: "${g.value}"`).join(' vs ')
          || 'Discrepant record found';
        doc.setTextColor(185, 28, 28);
        doc.text(`Outlier / Conflicting Record: ${outlierText}`, margin + 6, y + 17);

        // Recommended Operator Action
        const matchedGuidance = (analysis?.guidance ?? []).find(
          (g: any) => g.fieldKey === field.fieldKey || g.fieldLabel === field.label
        );
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        const actionIntro =
          field.status === 'extraction_invalid'
            ? 'Extraction issue: Citizen should re-upload or re-scan a clearer copy (checksum/format validation failed).'
            : matchedGuidance?.explanation || 'Apply for correction on the outlier document using consensus documents as proof.';
        const actionLines = doc.splitTextToSize(`Action: ${actionIntro}`, contentW - 12);
        doc.text(actionLines, margin + 6, y + 23);

        y += 33;
      }
    } else {
      addText('All 4 core identity fields (Name, Date of Birth, Gender, Address) establish full cross-document consensus. No corrective application is necessary.', 9);
      y += 4;
    }

    // Recommended Correction Procedures (From Guidance Engine)
    if (analysis?.guidance?.length > 0) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text('Recommended Official Procedure for Kendra Operator:', margin, y);
      y += 5;

      for (const g of analysis.guidance.slice(0, 2)) {
        if (g.steps && Array.isArray(g.steps)) {
          doc.setFontSize(8);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(51, 65, 85);
          for (let idx = 0; idx < Math.min(g.steps.length, 3); idx++) {
            const stepLine = `${idx + 1}. ${g.steps[idx]}`;
            const stepLines = doc.splitTextToSize(stepLine, contentW - 6);
            doc.text(stepLines, margin + 4, y);
            y += stepLines.length * 3.2 + 1;
          }
        }
      }
      y += 2;
    }

    // Operator Verification Checklist Box
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, y, contentW, 20, 2, 2, 'FD');
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('Operator Checklist (Before Submitting Application):', margin + 4, y + 5);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text('[  ] Verify citizen\'s physical original supporting documents corresponding to consensus values.', margin + 4, y + 10);
    doc.text('[  ] Submit formal demographic update on portal (e.g. UIDAI Self-Service / NSDL PAN 49A / MahaOnline).', margin + 4, y + 14);
    doc.text('[  ] Issue official update acknowledgement (URN / Acknowledgement Number) to citizen.', margin + 4, y + 18);

    y += 25;

    // Operator Sign-off & Notice
    doc.setFontSize(7);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(148, 163, 184);
    const slipNotice = 'NOTICE: This Resolution Slip is prepared by Nirdosh Vault to expedite correction workflows at Seva Kendras. It compares extracted identity evidence and does not replace official verification by issuing authorities.';
    const snLines = doc.splitTextToSize(slipNotice, contentW);
    doc.text(snLines, margin, y);

    doc.save(`kendra-resolution-slip-${safeFileId}.pdf`);
  };

  // ── Share on WhatsApp ───────────────────────────────────────────────────
  const handleShareWhatsApp = () => {
    const conflictCount = conflictingFields.length;
    const ref = analysisIdStr.slice(-5).toUpperCase();

    const conflictsText = conflictCount > 0
      ? conflictingFields.map((f: any) => {
          const outlier = f.outliers?.[0]?.value || 'Discrepancy found';
          return `• *${f.label}*: Consensus "${f.consensusValue || 'N/A'}" vs Outlier "${outlier}"`;
        }).join('\n')
      : '• All documents agree across checked fields.';

    const guidanceText = analysis?.guidance?.[0]?.explanation || 'Check Nirdosh Vault for step-by-step correction guidance.';

    const message = [
      '📋 *Nirdosh Vault — Kendra Resolution Slip*',
      `Ref: NV-${ref}`,
      `Applicant: ${applicantName}`,
      `Date: ${createdAtFormatted}`,
      '',
      `*Status:* ${conflictCount > 0 ? `⚠️ ${conflictCount} Discrepancy(ies) to Resolve` : '✅ All Documents Consistent'}`,
      '',
      '*Discrepancy Summary:*',
      conflictsText,
      '',
      '*Recommended Action:*',
      guidanceText,
      '',
      '📌 _Download your Kendra Resolution Slip PDF from Nirdosh Vault and present it to your nearest CSC / Aaple Sarkar Kendra._'
    ].join('\n');

    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        id="export-pdf-btn"
        onClick={handleExport}
        className="btn btn-secondary flex items-center gap-2"
        aria-label="Download Consensus Report PDF"
      >
        <Download size={16} />
        Download PDF
      </button>

      <button
        id="export-kendra-slip-btn"
        onClick={handleExportKendraSlip}
        className="btn btn-secondary flex items-center gap-2 text-saffron-600 dark:text-saffron-400 border-saffron-500/30 hover:bg-saffron-50 dark:hover:bg-saffron-500/10"
        aria-label="Download Kendra Resolution Slip PDF for Seva Kendra Operator"
      >
        <FileText size={16} />
        Kendra Resolution Slip
      </button>

      <button
        id="share-whatsapp-btn"
        onClick={handleShareWhatsApp}
        className="btn btn-secondary flex items-center gap-2 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
        aria-label="Share summary on WhatsApp"
      >
        <Share2 size={16} />
        Share on WhatsApp
      </button>
    </div>
  );
}