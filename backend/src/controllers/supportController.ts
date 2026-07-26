import { Request, Response } from 'express';
import SupportTicket from '../models/SupportTicket';
import SupportMessage from '../models/SupportMessage';
import User from '../models/User';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { sendEmail } from '../services/emailService';
import { getSocketIo } from '../socket';

import bcrypt from 'bcryptjs';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// @desc    Get user's active or recent ticket with messages
// @route   GET /api/support/ticket
// @access  Private
export const getUserTicket = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const role = String(req.user?.role || '').toLowerCase();
  if (!userId) throw new AppError('Not authorized', 401);
  if (role === 'helper') throw new AppError('Helpers must use the staff ticket inbox', 403);

  // Find user's active ticket or recently closed ticket that is not hidden by user
  let ticket = await SupportTicket.findOne({
    userId,
    userHidden: { $ne: true },
  }).sort({ updatedAt: -1 });

  if (!ticket) {
    return res.status(200).json({ success: true, data: null });
  }

  // Clear unread count for user when reading messages
  if (ticket.unreadUserCount && ticket.unreadUserCount > 0) {
    ticket.unreadUserCount = 0;
    await ticket.save();
  }

  const messages = await SupportMessage.find({ ticketId: ticket._id }).sort({ createdAt: 1 });

  res.status(200).json({
    success: true,
    data: {
      ticket,
      messages,
    },
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
    ticket = await SupportTicket.findOne({ userId, status: 'open', userHidden: { $ne: true } });

    // If no open ticket exists for user, create one
    if (!ticket) {
      ticket = await SupportTicket.create({
        userId,
        status: 'open',
        userHidden: false,
      });

      // Send email notification to admin about new ticket creation
      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail) {
        sendEmail(adminEmail, 'New Support Chat Started', `A user has started a new support chat.\n\nFirst message: ${message.trim()}`).catch(console.error);
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

  // Update unread counters
  if (isSupportStaff) {
    ticket.unreadUserCount = (ticket.unreadUserCount || 0) + 1;
  } else {
    ticket.unreadHelperCount = (ticket.unreadHelperCount || 0) + 1;
  }
  await ticket.save();

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

  // Automatically send email notification to the user if support staff replied
  if (isSupportStaff) {
    const userToNotify = await User.findById(ticket.userId);
    if (userToNotify && userToNotify.email) {
      sendEmail(userToNotify.email, 'New reply from Support', `You have a new reply on your support ticket.\n\nSupport says: ${message.trim()}`).catch(console.error);
    }
  }

  res.status(201).json({
    success: true,
    data: newMsg,
    ticketId: ticket._id,
  });
});

// @desc    Close a support ticket (requires helper PIN if closed by staff)
// @route   PATCH /api/support/ticket/:id/close
// @access  Private
export const closeTicket = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const role = String(req.user?.role || '').toLowerCase();
  const isSupportStaff = role === 'admin' || role === 'helper';
  const ticketId = req.params.id;
  const { helperPin, rating, comment } = req.body;

  if (!userId) throw new AppError('Not authorized', 401);

  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) throw new AppError('Ticket not found', 404);

  const staffUser = isSupportStaff ? await User.findById(userId) : null;

  if (isSupportStaff) {
    const pinToVerify = String(helperPin || '').trim();
    if (!pinToVerify || !/^\d{4}$/.test(pinToVerify)) {
      throw new AppError('A valid 4-digit Helper PIN is required to close tickets', 400);
    }

    if (!staffUser || !staffUser.helperPin) {
      throw new AppError('No Helper PIN configured for this account. Please contact an admin.', 403);
    }

    const pinMatch = await bcrypt.compare(pinToVerify, staffUser.helperPin);
    if (!pinMatch) {
      throw new AppError('Invalid Helper PIN', 401);
    }

    const now = new Date();
    ticket.status = 'closed';
    ticket.closedAt = now;
    ticket.closedBy = staffUser._id;
    ticket.helperClosed = true;
    ticket.feedbackPending = true;
    ticket.unreadUserCount = (ticket.unreadUserCount || 0) + 1; // notify user to give feedback
    await ticket.save();
  } else {
    // User manual closure
    if (ticket.userId.toString() !== userId) {
      throw new AppError('Not authorized to close this ticket', 403);
    }

    const now = new Date();
    ticket.status = 'closed';
    ticket.closedAt = now;
    ticket.closedBy = ticket.userId;
    ticket.userClosed = true;
    ticket.userHidden = true; // Hides from user side, preserves in DB for Admin
    ticket.feedbackPending = false;

    if (rating && Number(rating) >= 1 && Number(rating) <= 5) {
      ticket.feedbackRating = Number(rating);
    }
    if (comment) {
      ticket.feedbackComment = String(comment).trim();
    }
    await ticket.save();
  }

  try {
    const io = getSocketIo();
    if (io) {
      io.to(ticket._id.toString()).emit('ticket_closed', {
        ticketId: ticket._id,
        closedBy: isSupportStaff ? 'helper' : 'user',
        feedbackPending: ticket.feedbackPending,
      });
      io.to('admin_support').emit('admin_ticket_closed', { ticketId: ticket._id });
    }
  } catch (err) {
    console.warn('Socket emission failed', err);
  }

  res.status(200).json({
    success: true,
    message: 'Ticket closed successfully',
    data: ticket,
  });
});

// @desc    Submit user feedback for helper-closed ticket
// @route   POST /api/support/ticket/:id/feedback
// @access  Private
export const submitTicketFeedback = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const ticketId = req.params.id;
  const { rating, comment } = req.body;

  if (!userId) throw new AppError('Not authorized', 401);

  const ticket = await SupportTicket.findOne({ _id: ticketId, userId });
  if (!ticket) throw new AppError('Ticket not found', 404);

  const numericRating = Number(rating);
  if (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 5) {
    throw new AppError('Rating must be between 1 and 5 stars', 400);
  }

  ticket.feedbackRating = numericRating;
  if (comment) {
    ticket.feedbackComment = String(comment).trim();
  }
  ticket.feedbackPending = false;
  ticket.userHidden = true; // Hides from active user list, preserves in DB for Admin
  await ticket.save();

  res.status(200).json({
    success: true,
    message: 'Feedback submitted successfully',
    data: ticket,
  });
});

// @desc    Get unread support message/ticket badge counts
// @route   GET /api/support/unread-counts
// @access  Private
export const getUnreadCounts = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const role = String(req.user?.role || '').toLowerCase();
  const isSupportStaff = role === 'admin' || role === 'helper';

  if (!userId) throw new AppError('Not authorized', 401);

  if (isSupportStaff) {
    const unreadHelperTickets = await SupportTicket.countDocuments({
      status: 'open',
      $or: [{ unreadHelperCount: { $gt: 0 } }, { unreadHelperCount: { $exists: false } }],
    });
    return res.status(200).json({
      success: true,
      data: {
        unreadHelperTickets,
      },
    });
  }

  const activeTicket = await SupportTicket.findOne({
    userId,
    userHidden: { $ne: true },
  });

  const unreadUserMessages = activeTicket
    ? (activeTicket.unreadUserCount || 0) + (activeTicket.feedbackPending ? 1 : 0)
    : 0;

  res.status(200).json({
    success: true,
    data: {
      unreadUserMessages,
      feedbackPending: Boolean(activeTicket?.feedbackPending),
      ticketId: activeTicket?._id || null,
    },
  });
});

// @desc    Get all support tickets (admin/helper)
// @route   GET /api/support/admin/tickets
// @access  Private/Admin
export const getAdminTickets = asyncHandler(async (req: Request, res: Response) => {
  const search = String(req.query.search || '').trim().slice(0, 120);
  const status = String(req.query.status || '').trim().toLowerCase();
  const statusFilter = status === 'open' || status === 'closed' ? status : undefined;

  const tickets = await SupportTicket.find(statusFilter ? { status: statusFilter } : {})
    .sort({ updatedAt: -1 })
    .populate('userId', 'email plan')
    .populate('closedBy', 'email role');

  const ticketsWithPreview = await Promise.all(
    tickets.map(async (t) => {
      const latestMsg = await SupportMessage.findOne({ ticketId: t._id }).sort({ createdAt: -1 });
      return {
        ...t.toObject(),
        latestMessage: latestMsg ? latestMsg.message : 'No messages yet',
        latestMessageSender: latestMsg ? latestMsg.sender : null,
      };
    })
  );

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

// @desc    Get messages for a specific ticket (admin/helper)
// @route   GET /api/support/admin/tickets/:id/messages
// @access  Private/Admin
export const getAdminTicketMessages = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!id) throw new AppError('Ticket ID is required', 400);

  const messages = await SupportMessage.find({ ticketId: id as any }).sort({ createdAt: 1 });
  const ticket = await SupportTicket.findById(id).populate('userId', 'email').populate('closedBy', 'email role');

  if (!ticket) throw new AppError('Ticket not found', 404);

  // Clear unread helper count when admin views ticket
  if (ticket.unreadHelperCount && ticket.unreadHelperCount > 0) {
    ticket.unreadHelperCount = 0;
    await ticket.save();
  }

  res.status(200).json({
    success: true,
    data: {
      ticket,
      messages,
    },
  });
});
