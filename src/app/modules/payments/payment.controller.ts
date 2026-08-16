import { Request, Response } from "express";
import { z } from "zod";
import { renderInvoicePdf } from "../../lib/invoice-pdf.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { paginationSchema } from "../../utils/paginate.js";
import { PaymentService } from "./payment.service.js";

const listQuerySchema = paginationSchema.extend({
    status: z.enum(["PENDING", "SUCCESS", "FAILED", "REFUNDED"]).optional(),
});

const listOwn = asyncHandler(async (req: Request, res: Response) => {
    const query = listQuerySchema.parse(req.query);
    const { data, meta } = await PaymentService.listOwn(query);

    res.status(200).json({ success: true, message: "Payments retrieved", data, meta });
});

const getOwnById = asyncHandler(async (req: Request, res: Response) => {
    const payment = await PaymentService.getOwnById(String(req.params.id));

    res.status(200).json({ success: true, message: "Payment retrieved", data: payment });
});

/**
 * The invoice as a PDF.
 *
 * It goes through the same tenant-scoped lookup as the JSON view, so a payment
 * belonging to another organization is simply not found — the PDF route cannot
 * become a way around the scoping that protects the rest of billing.
 *
 * This is the one endpoint that does not return the standard envelope: the
 * response body is the file itself. An error still does, because failures are
 * thrown before anything is written and the global handler formats them.
 */
const downloadInvoice = asyncHandler(async (req: Request, res: Response) => {
    const payment = await PaymentService.getOwnById(String(req.params.id));

    const pdf = await renderInvoicePdf({
        invoiceNumber: payment.invoiceNumber,
        createdAt: payment.createdAt,
        amountCents: payment.amountCents,
        currency: payment.currency,
        status: payment.status,
        organization: payment.organization,
        subscription: payment.subscription,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
        "Content-Disposition",
        `attachment; filename="${payment.invoiceNumber}.pdf"`,
    );
    // Set explicitly so the browser can show real download progress rather than
    // an indeterminate spinner.
    res.setHeader("Content-Length", pdf.length);

    res.status(200).send(pdf);
});

export const PaymentController = { listOwn, getOwnById, downloadInvoice };
