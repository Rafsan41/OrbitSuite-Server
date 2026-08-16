import PDFDocument from "pdfkit";

/**
 * Renders a payment as a PDF invoice.
 *
 * pdfkit rather than a headless browser: the invoice is a fixed one-page layout
 * with no dynamic reflow, so the whole reason to pay for a browser — real CSS
 * layout — buys nothing here, while a Chromium binary would add roughly 180MB
 * to every install and a browser launch to every request.
 *
 * The buffer is assembled in memory and never written to disk. Invoices are
 * derived entirely from data we already hold, so storing them would create a
 * second copy to keep in sync with the payment record.
 */

const PAGE_MARGIN = 56;

/** Slate, matching the client's --text / --text-muted / --border. */
const INK = "#0f172a";
const MUTED = "#64748b";
const RULE = "#e2e8f0";
const BRAND = "#b85a3c";

export interface InvoiceData {
    invoiceNumber: string;
    createdAt: Date;
    amountCents: number;
    currency: string;
    status: string;
    organization: {
        name: string;
        billingEmail: string | null;
        contactEmail: string | null;
    };
    subscription: {
        currentPeriodEnd: Date | null;
        plan: { name: string; priceCents: number; billingInterval: string };
    } | null;
}

const money = (cents: number, currency: string) =>
    new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency.toUpperCase(),
    }).format(cents / 100);

/**
 * Deliberately ASCII-only, here and in the period separator below. The built-in
 * Helvetica is a WinAnsi font, and an em-dash or a typographic quote that fails
 * to encode leaves a blank or a wrong glyph in a document a customer keeps.
 */
const date = (value: Date | null | undefined) =>
    value
        ? new Intl.DateTimeFormat("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
          }).format(value)
        : "Not available";

/**
 * The billing period. A monthly plan paid on the 3rd covers the 3rd to the next
 * period end, so the start is derived by winding the interval back from the end
 * rather than guessing it from the payment date — a renewal payment can settle
 * days after the period it belongs to began.
 */
const billingPeriod = (data: InvoiceData): string => {
    const end = data.subscription?.currentPeriodEnd;
    if (!end) return "Not available";

    const start = new Date(end);
    if (data.subscription?.plan.billingInterval === "YEAR") {
        start.setFullYear(start.getFullYear() - 1);
    } else {
        start.setMonth(start.getMonth() - 1);
    }

    return `${date(start)} to ${date(end)}`;
};

export const renderInvoicePdf = (data: InvoiceData): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN });
        const chunks: Buffer[] = [];

        doc.on("data", (chunk: Buffer) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        const left = PAGE_MARGIN;
        const right = doc.page.width - PAGE_MARGIN;
        const width = right - left;

        // --- Header -------------------------------------------------------
        doc.fillColor(BRAND).fontSize(20).font("Helvetica-Bold").text("OrbitSuite", left, left);

        doc.fillColor(MUTED)
            .fontSize(9)
            .font("Helvetica")
            .text("OrbitSuite Platform", left, doc.y + 2);

        // Invoice number and date, right-aligned against the wordmark.
        doc.fillColor(INK)
            .fontSize(16)
            .font("Helvetica-Bold")
            .text("INVOICE", left, left, { width, align: "right" });

        doc.fillColor(MUTED)
            .fontSize(10)
            .font("Helvetica")
            .text(data.invoiceNumber, left, doc.y + 2, { width, align: "right" })
            .text(`Issued ${date(data.createdAt)}`, left, doc.y + 2, {
                width,
                align: "right",
            });

        let y = Math.max(doc.y, left + 70) + 24;

        doc.moveTo(left, y).lineTo(right, y).strokeColor(RULE).lineWidth(1).stroke();
        y += 24;

        // --- Billed to ----------------------------------------------------
        doc.fillColor(MUTED).fontSize(9).font("Helvetica-Bold").text("BILLED TO", left, y);

        doc.fillColor(INK)
            .fontSize(12)
            .font("Helvetica-Bold")
            .text(data.organization.name, left, doc.y + 6);

        const billingEmail = data.organization.billingEmail ?? data.organization.contactEmail;
        if (billingEmail) {
            doc.fillColor(MUTED).fontSize(10).font("Helvetica").text(billingEmail, left, doc.y + 2);
        }

        y = doc.y + 28;

        // --- Line item table ----------------------------------------------
        const amountX = right - 110;

        doc.fillColor(MUTED).fontSize(9).font("Helvetica-Bold");
        doc.text("DESCRIPTION", left, y);
        doc.text("AMOUNT", amountX, y, { width: 110, align: "right" });

        y = doc.y + 8;
        doc.moveTo(left, y).lineTo(right, y).strokeColor(RULE).stroke();
        y += 14;

        const planName = data.subscription?.plan.name ?? "Subscription";
        const interval = data.subscription?.plan.billingInterval.toLowerCase();

        doc.fillColor(INK).fontSize(11).font("Helvetica-Bold");
        doc.text(`${planName} plan`, left, y, { width: amountX - left - 12 });
        doc.text(money(data.amountCents, data.currency), amountX, y, {
            width: 110,
            align: "right",
        });

        doc.fillColor(MUTED).fontSize(9).font("Helvetica");
        doc.text(
            interval ? `Billed per ${interval}` : "Subscription charge",
            left,
            doc.y + 4,
            { width: amountX - left - 12 },
        );
        doc.text(`Billing period: ${billingPeriod(data)}`, left, doc.y + 3, {
            width: amountX - left - 12,
        });

        y = doc.y + 18;
        doc.moveTo(left, y).lineTo(right, y).strokeColor(RULE).stroke();
        y += 16;

        // --- Total --------------------------------------------------------
        doc.fillColor(INK).fontSize(11).font("Helvetica-Bold");
        doc.text("Total paid", left, y);
        doc.fontSize(14).text(money(data.amountCents, data.currency), amountX, y - 3, {
            width: 110,
            align: "right",
        });

        y = doc.y + 26;

        // --- Payment detail ------------------------------------------------
        doc.fillColor(MUTED).fontSize(9).font("Helvetica-Bold").text("PAYMENT", left, y);
        y = doc.y + 8;

        const rows: [string, string][] = [
            ["Payment date", date(data.createdAt)],
            ["Status", data.status.charAt(0) + data.status.slice(1).toLowerCase()],
            ["Invoice number", data.invoiceNumber],
        ];

        for (const [label, value] of rows) {
            doc.fillColor(MUTED).fontSize(10).font("Helvetica").text(label, left, y);
            doc.fillColor(INK)
                .font("Helvetica-Bold")
                .text(value, amountX - 80, y, { width: 190, align: "right" });
            y += 18;
        }

        // --- Footer --------------------------------------------------------
        doc.fillColor(MUTED)
            .fontSize(8)
            .font("Helvetica")
            .text(
                "This invoice was generated automatically by OrbitSuite. No signature is required.",
                left,
                doc.page.height - PAGE_MARGIN - 14,
                { width, align: "center" },
            );

        doc.end();
    });
