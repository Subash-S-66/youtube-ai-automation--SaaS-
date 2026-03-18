import { Request, Response } from 'express';
import SupportTicket from '../models/SupportTicket';
import User from '../models/User';
import asyncHandler from '../utils/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { CreateSupportTicketInput } from '../utils/validators/supportValidators';
import { sendEmail } from '../services/emailService';

// @desc    Create a new support ticket
// @route   POST /api/support
// @access  Private
export const createTicket = asyncHandler(
  async (req: Request<unknown, unknown, CreateSupportTicketInput>, res: Response) => {
    const { subject, message } = req.body;

    if (!req.user || !req.user.id) {
      throw new AppError('Not authorized', 401);
    }

    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const ticket = await SupportTicket.create({
      userId,
      subject,
      message,
      status: 'open',
    });

    // Send confirmation email to user
    const userEmailSubject = 'Support Request Received: ' + subject;
    const userEmailBody = `Hello,\n\nWe have received your support request: "${subject}". Our team will get back to you shortly.\n\nYour message:\n${message}\n\nBest,\nClipForge Team`;
    sendEmail(user.email, userEmailSubject, userEmailBody).catch(console.error);

    // Send notification email to admin
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      const adminEmailSubject = 'New Support Ticket: ' + subject;
      const adminEmailBody = `A new support ticket has been submitted by ${user.email}.\n\nSubject: ${subject}\n\nMessage:\n${message}`;
      sendEmail(adminEmail, adminEmailSubject, adminEmailBody).catch(console.error);
    } else {
        console.warn('ADMIN_EMAIL environment variable is not set. Admin support notifications will not be sent.');
    }

    res.status(201).json({
      success: true,
      message: 'Your request has been submitted',
      data: ticket,
    });
  }
);
