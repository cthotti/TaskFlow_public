// pages/api/extracted/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "@/lib/db";
import ExtractedTask from "@/models/ExtractedTasks";

type Data = any;

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Attempt to find a task by:
 * 1) direct _id (findById)
 * 2) parsed _source_account (email) + source_email_ts (ISO)
 * 3) parsed source_email_ts only
 * 4) parsed _source_account (email) only
 * 5) fuzzy title match extracted from the provided id-like string
 */
async function findTaskByIdOrFallback(candidate: string) {
  if (!candidate) return null;

  // 1) try direct findById (wrap in try/catch because invalid ObjectId casts can throw)
  try {
    const byId = await ExtractedTask.findById(candidate);
    if (byId) {
      console.info("findTaskByIdOrFallback: matched by _id");
      return { task: byId, reason: "by_id" };
    }
  } catch (err) {
    // ignore cast error, continue to other strategies
    console.debug("findTaskByIdOrFallback: findById cast failed", err);
  }

  // 2) try to parse email and iso timestamp from the candidate string
  const emailMatch = candidate.match(/[\w.+-]+@[\w.-]+\.\w+/);
  const isoTsMatch = candidate.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?/);
  if (emailMatch && isoTsMatch) {
    const email = emailMatch[0];
    const ts = isoTsMatch[0];
    const byCombo = await ExtractedTask.findOne({ _source_account: email, source_email_ts: ts });
    if (byCombo) {
      console.info("findTaskByIdOrFallback: matched by _source_account + source_email_ts", { email, ts });
      return { task: byCombo, reason: "by_account_and_ts", meta: { email, ts } };
    }
  }

  // 3) try timestamp-only match (exact)
  if (isoTsMatch) {
    const ts = isoTsMatch[0];
    const byTs = await ExtractedTask.findOne({ source_email_ts: ts });
    if (byTs) {
      console.info("findTaskByIdOrFallback: matched by source_email_ts", { ts });
      return { task: byTs, reason: "by_ts", meta: { ts } };
    }
  }

  // 4) try account-only match
  if (emailMatch) {
    const email = emailMatch[0];
    const byAccount = await ExtractedTask.findOne({ _source_account: email });
    if (byAccount) {
      console.info("findTaskByIdOrFallback: matched by _source_account", { email });
      return { task: byAccount, reason: "by_account", meta: { email } };
    }
  }

  // 5) title fuzzy match fallback: remove email/ts from candidate and try regex on title
  let titleCandidate = candidate;
  if (emailMatch) titleCandidate = titleCandidate.replace(emailMatch[0], " ");
  if (isoTsMatch) titleCandidate = titleCandidate.replace(isoTsMatch[0], " ");
  // replace dashes/underscores with spaces, trim
  titleCandidate = titleCandidate.replace(/[-_]+/g, " ").trim();

  if (titleCandidate.length >= 3) {
    const escaped = escapeRegex(titleCandidate);
    // use case-insensitive contains match
    const byTitle = await ExtractedTask.findOne({ title: { $regex: escaped, $options: "i" } });
    if (byTitle) {
      console.info("findTaskByIdOrFallback: matched by title regex", { titleCandidate });
      return { task: byTitle, reason: "by_title", meta: { titleCandidate } };
    }
  }

  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Data>) {
  await connectDB();

  try {
    if (req.method === "GET") {
      // Return all tasks (newest first)
      const tasks = await ExtractedTask.find({}).sort({ date: -1, _id: -1 });
      return res.status(200).json(tasks);
    }

    if (req.method === "POST") {
      const {
        title,
        description,
        date,
        time,
        source_subject,
        source_from,
        confidence,
        _source_account,
        source_email_ts,
      } = req.body;
      if (!title) return res.status(400).json({ error: "title required" });

      const task = await ExtractedTask.create({
        title,
        description,
        date,
        time,
        source_subject,
        source_from,
        confidence,
        _source_account,
        source_email_ts,
      });
      return res.status(201).json(task);
    }

    if (req.method === "PATCH") {
      const { id, addedToCalendar } = req.body;
      if (!id) return res.status(400).json({ error: "id required" });

      // 1) try direct findByIdAndUpdate (wrap try/catch for invalid id formats)
      try {
        const updated = await ExtractedTask.findByIdAndUpdate(id, { addedToCalendar }, { new: true });
        if (updated) {
          console.info("PATCH: updated by _id", id);
          return res.status(200).json(updated);
        }
      } catch (err) {
        console.debug("PATCH: findByIdAndUpdate cast failed - will try fallback strategies", err);
      }

      // 2) fallback search strategies
      const fallback = await findTaskByIdOrFallback(id);
      if (fallback && fallback.task) {
        const updatedFallback = await ExtractedTask.findByIdAndUpdate(
          (fallback.task as any)._id,
          { addedToCalendar },
          { new: true }
        );
        if (updatedFallback) {
          console.info("PATCH: updated by fallback", fallback.reason, fallback.meta || {});
          return res.status(200).json(updatedFallback);
        }
      }

      return res.status(404).json({ error: "task not found", tried: ["id", "fallback"] });
    }

    if (req.method === "DELETE") {
      const { id } = req.query;
      if (!id || typeof id !== "string") {
        return res.status(400).json({ error: "id query param required" });
      }

      // 1) try direct findByIdAndDelete (wrap in try/catch)
      try {
        const deleted = await ExtractedTask.findByIdAndDelete(id);
        if (deleted) {
          console.info("DELETE: deleted by _id", id);
          return res.status(200).json({ message: "Deleted", id: deleted._id });
        }
      } catch (err) {
        console.debug("DELETE: findByIdAndDelete cast failed - will try fallback strategies", err);
      }

      // 2) fallback: attempt to locate by parsed account/ts/title
      const fallback = await findTaskByIdOrFallback(id);
      if (fallback && fallback.task) {
        const deleted2 = await ExtractedTask.findByIdAndDelete((fallback.task as any)._id);
        if (deleted2) {
          console.info("DELETE: deleted by fallback", fallback.reason, fallback.meta || {});
          return res.status(200).json({ message: "Deleted", id: deleted2._id, fallback: fallback.reason });
        }
      }

      return res.status(404).json({ error: "task not found", tried: ["id", "fallback"] });
    }

    return res.status(405).end();
  } catch (err: any) {
    console.error("Error in /api/extracted:", err);
    return res.status(500).json({ error: "Internal server error", details: err?.message || err });
  }
}
