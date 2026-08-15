import { Request, Response } from "express";
import { asyncHandler } from "../../utils/async-handler.js";
import { PlanService } from "./plan.service.js";
import { listPlansSchema } from "./plan.validation.js";

const list = asyncHandler(async (req: Request, res: Response) => {
    const query = listPlansSchema.parse(req.query);
    const { data, meta } = await PlanService.list(query);

    res.status(200).json({ success: true, message: "Plans retrieved", data, meta });
});

const getById = asyncHandler(async (req: Request, res: Response) => {
    const plan = await PlanService.getById(String(req.params.id));

    res.status(200).json({ success: true, message: "Plan retrieved", data: plan });
});

const create = asyncHandler(async (req: Request, res: Response) => {
    const plan = await PlanService.create(req.body);

    res.status(201).json({ success: true, message: "Plan created", data: plan });
});

const update = asyncHandler(async (req: Request, res: Response) => {
    const plan = await PlanService.update(String(req.params.id), req.body);

    res.status(200).json({ success: true, message: "Plan updated", data: plan });
});

const setActive = asyncHandler(async (req: Request, res: Response) => {
    const isActive = req.path.endsWith("/enable");
    const plan = await PlanService.setActive(String(req.params.id), isActive);

    res.status(200).json({
        success: true,
        message: isActive ? "Plan enabled" : "Plan disabled",
        data: plan,
    });
});

export const PlanController = { list, getById, create, update, setActive };
