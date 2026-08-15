import { Request, Response } from "express";
import { asyncHandler } from "../../utils/async-handler.js";
import { SubscriptionService } from "./subscription.service.js";

const getCurrent = asyncHandler(async (req: Request, res: Response) => {
    const subscription = await SubscriptionService.getCurrent(req.user!);

    res.status(200).json({ success: true, message: "Subscription retrieved", data: subscription });
});

const changePlan = asyncHandler(async (req: Request, res: Response) => {
    const result = await SubscriptionService.changePlan(req.user!, req.body);

    res.status(200).json({
        success: true,
        message: `Subscription ${result.direction} complete`,
        data: result,
    });
});

const cancel = asyncHandler(async (req: Request, res: Response) => {
    const result = await SubscriptionService.cancel(req.user!, req.body);

    res.status(200).json({ success: true, message: result.message, data: result });
});

const expireLapsed = asyncHandler(async (_req: Request, res: Response) => {
    const result = await SubscriptionService.expireLapsed();

    res.status(200).json({
        success: true,
        message: `${result.expired} subscription(s) marked expired`,
        data: result,
    });
});

const expiringSoon = asyncHandler(async (_req: Request, res: Response) => {
    const data = await SubscriptionService.findExpiringSoon();

    res.status(200).json({ success: true, message: "Expiring subscriptions retrieved", data });
});

const notifyExpiringSoon = asyncHandler(async (_req: Request, res: Response) => {
    const result = await SubscriptionService.notifyExpiringSoon();

    res.status(200).json({
        success: true,
        message: `${result.notified} reminder(s) queued`,
        data: result,
    });
});

export const SubscriptionController = {
    getCurrent,
    changePlan,
    cancel,
    expireLapsed,
    expiringSoon,
    notifyExpiringSoon,
};
