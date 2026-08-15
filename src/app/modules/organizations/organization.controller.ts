import { Request, Response } from "express";
import { asyncHandler } from "../../utils/async-handler.js";
import { OrganizationService } from "./organization.service.js";
import { listOrganizationsSchema } from "./organization.validation.js";

const listAll = asyncHandler(async (req: Request, res: Response) => {
    const query = listOrganizationsSchema.parse(req.query);
    const { data, meta } = await OrganizationService.listAll(query);

    res.status(200).json({ success: true, message: "Organizations retrieved", data, meta });
});

const getByIdAsAdmin = asyncHandler(async (req: Request, res: Response) => {
    const organization = await OrganizationService.getByIdAsAdmin(String(req.params.id));

    res.status(200).json({ success: true, message: "Organization retrieved", data: organization });
});

const getOwn = asyncHandler(async (req: Request, res: Response) => {
    const organization = await OrganizationService.getOwn(req.user!);

    res.status(200).json({ success: true, message: "Organization retrieved", data: organization });
});

const getOwnPublic = asyncHandler(async (req: Request, res: Response) => {
    const organization = await OrganizationService.getOwnPublic(req.user!);

    res.status(200).json({ success: true, message: "Organization retrieved", data: organization });
});

const updateOwn = asyncHandler(async (req: Request, res: Response) => {
    const organization = await OrganizationService.updateOwn(req.user!, req.body);

    res.status(200).json({ success: true, message: "Organization updated", data: organization });
});

const setSuspended = asyncHandler(async (req: Request, res: Response) => {
    const suspended = req.path.endsWith("/suspend");
    const organization = await OrganizationService.setSuspended(String(req.params.id), suspended);

    res.status(200).json({
        success: true,
        message: suspended ? "Organization suspended" : "Organization reactivated",
        data: organization,
    });
});

export const OrganizationController = {
    listAll,
    getByIdAsAdmin,
    getOwn,
    getOwnPublic,
    updateOwn,
    setSuspended,
};
