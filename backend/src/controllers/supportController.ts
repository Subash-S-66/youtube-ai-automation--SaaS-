import { Request, Response } from 'express';
import SupportTicket from '../models/SupportTicket';
import SupportMessage from '../models/SupportMessage';
import User from '../models/User';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { sendEmail } from '../services/emailService';
import { getSocketIo } from '../socket';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Helper to determine if an old ticket is still valid for read-only view (24h window)
const isTicketIn24hWindow = (ticket: any): boolean => {
  if (ticket.status === 'open') return true;
  if (!ticket.expireAt) return false;
  return new Date() < new Date(ticket.expireAt);
};

// @desc    Get user's current or recent ticket with messages
// @route   GET /api/support/ticket
// @access  Private
export const getUserTicket = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const role = String(req.user?.role || '').toLowerCase();
  if (!userId) throw new AppError('Not authorized', 401);
  if (role === 'helper') throw new AppError('Helpers must use the staff ticket inbox', 403);

  // Find an open ticket first
  let ticket = await SupportTicket.findOne({ userId, status: 'open' });

  // If no open ticket, look for a recently closed one (within 24h)
  if (!ticket) {
    const now = new Date();
    ticket = await SupportTicket.findOne({
      userId,
      status: 'closed',
      expireAt: { $gt: now }
    }).sort({ closedAt: -1 }); // Get most recently closed
  }

  if (!ticket) {
    return res.status(200).json({ success: true, data: null });
  }

  const messages = await SupportMessage.find({ ticketId: ticket._id }).sort({ createdAt: 1 });

  res.status(200).json({
    success: true,
    data: {
      ticket,
      messages
    }
  });
});

// @desc    Send a message (auto-creates ticket if needed)
// @route   POST /api/support/message
// @access  Private
export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { message, ticketId } = req.body;
  const role = String(req.user?.role || '').toLowerCase();
  const isSupportStaff = role === 'admin' || role === 'helper';

  if (!userId) throw new AppError('Not authorized', 401);
  if (!message || message.trim() === '') {
    throw new AppError('Message is required', 400);
  }

  let ticket;

  if (isSupportStaff) {
    if (!ticketId) throw new AppError('ticketId required for support reply', 400);
    ticket = await SupportTicket.findById(ticketId);
    if (!ticket) throw new AppError('Ticket not found', 404);
  } else {
    ticket = await SupportTicket.findOne({ userId, status: 'open' });

    // If no open ticket exists for user, create one
    if (!ticket) {
      ticket = await SupportTicket.create({
        userId,
        status: 'open'
      });

      // Send email notification to admin about new ticket creation
      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail) {
         sendEmail(adminEmail, "New Support Chat Started", `A user has started a new support chat.\n\nFirst message: ${message.trim()}`).catch(console.error);
      }
    }
  }

  if (ticket.status === 'closed') {
    throw new AppError('Cannot reply to a closed ticket', 400);
  }

  const newMsg = await SupportMessage.create({
    ticketId: ticket._id,
    sender: isSupportStaff ? 'admin' : 'user',
    message: message.trim(),
  });

  // Emit to socket
  try {
    const io = getSocketIo();
    if (io) {
      io.to(ticket._id.toString()).emit('receive_message', newMsg);
      io.to('admin_support').emit('admin_ticket_update', { ticketId: ticket._id, message: newMsg });
    }
  } catch (err) {
    console.warn('Socket emission failed', err);
  }

  // Automatically send email notification to the user if an admin replied
  if (isSupportStaff) {
     const userToNotify = await User.findById(ticket.userId);
     if (userToNotify && userToNotify.email) {
        sendEmail(userToNotify.email, "New reply from Support", `You have a new reply on your support ticket.\n\nSupport says: ${message.trim()}`).catch(console.error);
     }
  }

  res.status(201).json({
    success: true,
    data: newMsg,
    ticketId: ticket._id
  });
});

// @desc    Close a support ticket (user or admin)
// @route   PATCH /api/support/ticket/:id/close
// @access  Private
export const closeTicket = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const role = String(req.user?.role || '').toLowerCase();
  const isAdmin = role === 'admin';
  const ticketId = req.params.id;

  if (!userId) throw new AppError('Not authorized', 401);
  if (role === 'helper') {
    throw new AppError('Helpers are not authorized to close tickets', 403);
  }

  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) throw new AppError('Ticket not found', 404);

  // Validate ownership
  if (!isAdmin && ticket.userId.toString() !== userId) {
    throw new AppError('Not authorized to close this ticket', 403);
  }

  if (ticket.status === 'closed') {
    return res.status(200).json({ success: true, message: 'Already closed' });
  }

  const now = new Date();
  const expireAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now

  ticket.status = 'closed';
  ticket.closedAt = now;
  ticket.expireAt = expireAt;
  await ticket.save();

  try {
    const io = getSocketIo();
    if (io) {
      io.to(ticket._id.toString()).emit('ticket_closed', { ticketId: ticket._id, closedBy: isAdmin ? 'admin' : 'user', expireAt });
      io.to('admin_support').emit('admin_ticket_closed', { ticketId: ticket._id });
    }
  } catch (err) {
    console.warn('Socket emission failed', err);
  }

  res.status(200).json({
    success: true,
    message: 'Ticket closed successfully',
    data: ticket
  });
});

// @desc    Get all support tickets (admin)
// @route   GET /api/support/admin/tickets
// @access  Private/Admin
export const getAdminTickets = asyncHandler(async (req: Request, res: Response) => {
  const search = String(req.query.search || '').trim().slice(0, 120);
  const status = String(req.query.status || '').trim().toLowerCase();
  const statusFilter = status === 'open' || status === 'closed' ? status : undefined;

  const tickets = await SupportTicket.find(statusFilter ? { status: statusFilter } : {})
    .sort({ updatedAt: -1 })
    .populate('userId', 'email plan');

  // We need to fetch the latest message for preview in the admin list
  const ticketsWithPreview = await Promise.all(tickets.map(async (t) => {
    const latestMsg = await SupportMessage.findOne({ ticketId: t._id }).sort({ createdAt: -1 });
    return {
      ...t.toObject(),
      latestMessage: latestMsg ? latestMsg.message : 'No messages yet',
      latestMessageSender: latestMsg ? latestMsg.sender : null
    };
  }));

  const filteredTickets = search
    ? ticketsWithPreview.filter((ticket: any) => {
        const searchRegex = new RegExp(escapeRegex(search), 'i');
        return (
          searchRegex.test(String(ticket?.userId?.email || '')) ||
          searchRegex.test(String(ticket?.latestMessage || '')) ||
          searchRegex.test(String(ticket?.status || ''))
        );
      })
    : ticketsWithPreview;

  res.status(200).json({
    success: true,
    data: filteredTickets,
  });
});

// @desc    Get messages for a specific ticket (admin)
// @route   GET /api/support/admin/tickets/:id/messages
// @access  Private/Admin
export const getAdminTicketMessages = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!id) throw new AppError('Ticket ID is required', 400);

  const messages = await SupportMessage.find({ ticketId: id as any }).sort({ createdAt: 1 });
  const ticket = await SupportTicket.findById(id).populate('userId', 'email');

  if (!ticket) throw new AppError('Ticket not found', 404);

  res.status(200).json({
    success: true,
    data: {
      ticket,
      messages
    }
  });
});
