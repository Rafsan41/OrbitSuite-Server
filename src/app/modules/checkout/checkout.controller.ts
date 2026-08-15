import { Request, Response } from "express";
import { CheckoutService } from "./checkout.service.js";
import { asyncHandler } from "../../utils/async-handler.js";

const createSession = asyncHandler(async (req: Request, res: Response) => {
    const data = await CheckoutService.createSession(req.user!);
    res.status(201).json({ success: true, message: "Checkout session created", data });
});

const getStatus = asyncHandler(async (req: Request, res: Response) => {
    const data = await CheckoutService.getStatus(req.user!);
    res.status(200).json({ success: true, message: "Checkout status retrieved", data });
});

export const CheckoutController = { createSession, getStatus };
