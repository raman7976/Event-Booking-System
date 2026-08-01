// HTTP layer for the bus agentic-RAG features: the student assistant and the
// admin text-to-SQL analytics. Thin wrappers; identity comes from req.user.
import { asyncHandler } from '../utils/asyncHandler.js';
import { ask } from '../services/busAgentService.js';
import { query as analyticsQuery } from '../services/adminAnalyticsService.js';

export const assistant = asyncHandler(async (req, res) => {
  const { message, history } = req.body;
  const result = await ask({
    user: req.user,
    message,
    history: Array.isArray(history) ? history : [],
  });
  res.json(result);
});

export const adminAnalytics = asyncHandler(async (req, res) => {
  res.json(await analyticsQuery({ question: req.body.question }));
});
