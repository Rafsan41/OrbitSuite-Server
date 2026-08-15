import { Request, Response } from "express";
import { z } from "zod";
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

export const PaymentController = { listOwn, getOwnById };
