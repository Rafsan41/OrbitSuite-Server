import { Request, Response } from "express";
import { asyncHandler } from "../../utils/async-handler.js";
import { UserService } from "./user.service.js";
import { listMembersSchema } from "./user.validation.js";
import { NotificationService } from "../notifications/notification.service.js";

const listMembers = asyncHandler(async (req: Request, res: Response) => {
    const query = listMembersSchema.parse(req.query);
    const { data, meta } = await UserService.listMembers(query);

    res.status(200).json({ success: true, message: "Members retrieved", data, meta });
});

const inviteMember = asyncHandler(async (req: Request, res: Response) => {
    const { user, inviteToken, organizationName, invitedBy } = await UserService.inviteMember(
        req.user!,
        req.body,
    );

    // Dispatched, not awaited: the invite is already persisted, so a slow or
    // failing SMTP server must not turn a successful invite into an error.
    // The token travels by email alone and never appears in the response.
    NotificationService.memberInvited({
        to: user.email,
        inviteeName: user.name,
        organizationName,
        invitedBy,
        token: inviteToken,
    });

    res.status(201).json({ success: true, message: "Invitation sent", data: user });
});

const acceptInvite = asyncHandler(async (req: Request, res: Response) => {
    await UserService.acceptInvite(req.body);

    res.status(200).json({
        success: true,
        message: "Invitation accepted, you can now sign in",
        data: null,
    });
});

const getMember = asyncHandler(async (req: Request, res: Response) => {
    const member = await UserService.getMember(String(req.params.id));

    res.status(200).json({ success: true, message: "Member retrieved", data: member });
});

const removeMember = asyncHandler(async (req: Request, res: Response) => {
    const member = await UserService.removeMember(req.user!, String(req.params.id));

    res.status(200).json({ success: true, message: "Member removed", data: member });
});

const changeRole = asyncHandler(async (req: Request, res: Response) => {
    const member = await UserService.changeRole(req.user!, String(req.params.id), req.body);

    res.status(200).json({ success: true, message: "Member role updated", data: member });
});

const getOwnProfile = asyncHandler(async (req: Request, res: Response) => {
    const profile = await UserService.getOwnProfile(req.user!);

    res.status(200).json({ success: true, message: "Profile retrieved", data: profile });
});

const updateOwnProfile = asyncHandler(async (req: Request, res: Response) => {
    const profile = await UserService.updateOwnProfile(req.user!, req.body);

    res.status(200).json({ success: true, message: "Profile updated", data: profile });
});

export const UserController = {
    listMembers,
    inviteMember,
    acceptInvite,
    getMember,
    removeMember,
    changeRole,
    getOwnProfile,
    updateOwnProfile,
};
