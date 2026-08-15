import { Request, Response } from "express";
import { asyncHandler } from "../../utils/async-handler.js";
import { TransactionService } from "./transaction.service.js";
import { listTransactionsSchema } from "./transaction.validation.js";

const listOwn = asyncHandler(async (req: Request, res: Response) => {
    const query = listTransactionsSchema.parse(req.query);
    const { data, meta } = await TransactionService.listOwn(query);

    res.status(200).json({ success: true, message: "Transactions retrieved", data, meta });
});

const listAll = asyncHandler(async (req: Request, res: Response) => {
    const query = listTransactionsSchema.parse(req.query);
    const { data, meta } = await TransactionService.listAll(query);

    res.status(200).json({ success: true, message: "Transactions retrieved", data, meta });
});

export const TransactionController = { listOwn, listAll };
