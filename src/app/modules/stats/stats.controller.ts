import { Request, Response } from "express";
import { asyncHandler } from "../../utils/async-handler.js";
import { StatsService } from "./stats.service.js";

const getOverview = asyncHandler(async (_req: Request, res: Response) => {
    const data = await StatsService.getOverview();

    res.status(200).json({ success: true, message: "Platform statistics retrieved", data });
});

export const StatsController = { getOverview };
