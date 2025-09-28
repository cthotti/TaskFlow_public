
// pages/api/extracted/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "@/lib/db";
import ExtractedTask from "@/models/ExtractedTasks";
import mongoose from "mongoose";

type Data = any;

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Try to locate a task using several lookup strategies:
 * - findById (valid ObjectId string)
 * - findOne({ _id: candidate }) (handles documents whose _id is a string, not ObjectId)
 * - findOne({ _source_account, source_email_ts }) if both found in candidate
 * - findOne({ source_email_ts }) or findOne({ _source_account })
 * - fuzzy title match
 */
async function findTaskByIdOrFallback(candidate: string) {
  if (!candidate) return null;

  // 1) try ObjectId path
  if (mongoose.Types.ObjectId.isValid(candidate)) {
    try {
      const byId = await ExtractedTask.findById(candidate);
      if (byId) return { task: byId, reason: "by_id_objectid" };
    } catch (err) {
      // continue to other strategies
      console.debug("findTaskByIdOrFallback: findById failed", (err as Error).message);
    }
  }

  // 2) try literal _id value (string _id stored by other writer)
  try {
    const byLiteralId = await ExtractedTask.findOne({ _id: candidate });
    if (byLiteralId) return { task: byLiteralId, reason: "by_id_literal" };
  } catch (err) {
    console.debug("findTaskByIdOrFallback: findOne by literal _id failed", (err as Error).message);
  }

  // 3) try parse email and iso timestamp from candidate
  const emailMatch = candidate.match(/[\w.+-]+@[\w.-]+\.\w+/);
  const isoTsMatch = candidate.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?/);
  if (emailMatch && isoTsMatch) {
    const email = emailMatch[0];
    const ts = isoTsMatch[0];
    const byCombo = await ExtractedTask.findOne({ _source_account: email, source_email_ts: ts });
    if (byCombo) return { task: byCombo, reason: "by_account_and_ts", meta: { email, ts } };
  }

  // 4) try timestamp-only match
  if (isoTsMatch) {
    const ts = isoTsMatch[0];
    const byTs = await ExtractedTask.findOne({ source_email_ts: ts });
    if (byTs) return { task: byTs, reason: "by_ts", meta: { ts } };
  }

  // 5) try account-only match
  if (emailMatch) {
    const email = emailMatch[0];
    const byAccount = await ExtractedTask.findOne({ _source_account: email });
    if (byAccount) return { task: byAccount, reason: "by_account", meta: { email } };
  }

  // 6) fuzzy title match
  let titleCandidate = candidate;
  if (emailMatch) titleCandidate = titleCandidate.replace(emailMatch[0], " ");
  if (isoTsMatch) titleCandidate = titleCandidate.replace(isoTsMatch[0], " ");
  titleCandidate = titleCandidate.replace(/[-_]+/g, " ").trim();

  if (titleCandidate.length >= 3) {
    const escaped = escapeRegex(titleCandidate);
    const byTitle = await ExtractedTask.findOne({ title: { $regex: escaped, $options: "i" } });
    if (byTitle) return { task: byTitle, reason: "by_title", meta: { titleCandidate } };
  }

  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Data>) {
  await connectDB();

  try {
    if (req.method === "GET") {
      const tasks = await ExtractedTask.find({}).sort({ date: -1, _id: -1 });
      return res.status(200).json(tasks);
    }

    if (req.method === "POST") {
      const { title, description, date, time, source_subject, source_from, confidence, _source_account, source_email_ts } = req.body;
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

      // Fast path 1: findById if valid ObjectId
      try {
        if (mongoose.Types.ObjectId.isValid(id)) {
          const updated = await ExtractedTask.findByIdAndUpdate(id, { addedToCalendar }, { new: true });
          if (updated) {
            console.info("PATCH: updated by objectid", id);
            return res.status(200).json(updated);
          }
        }
      } catch (err) {
        console.debug("PATCH: objectid path failed", (err as Error).message);
      }

      // Fast path 2: direct literal _id match (string _id stored by other writer)
      try {
        const direct = await ExtractedTask.findOneAndUpdate({ _id: id }, { addedToCalendar }, { new: true });
        if (direct) {
          console.info("PATCH: updated by literal _id", id);
          return res.status(200).json(direct);
        }
      } catch (err) {
        console.debug("PATCH: literal _id path failed", (err as Error).message);
      }

      // Fallback strategies
      const fallback = await findTaskByIdOrFallback(id);
      if (fallback?.task) {
        const updatedFallback = await ExtractedTask.findByIdAndUpdate((fallback.task as any)._id, { addedToCalendar }, { new: true });
        if (updatedFallback) {
          console.info("PATCH: updated by fallback", fallback.reason, fallback.meta || {});
          return res.status(200).json(updatedFallback);
        }
      }

      return res.status(404).json({ error: "task not found", tried: ["objectid", "literal_id", "fallback"] });
    }

    if (req.method === "DELETE") {
      const { id } = req.query;
      if (!id || typeof id !== "string") {
        return res.status(400).json({ error: "id query param required" });
      }

      // 1) try objectid deletion
      try {
        if (mongoose.Types.ObjectId.isValid(id)) {
          const deleted = await ExtractedTask.findByIdAndDelete(id);
          if (deleted) {
            console.info("DELETE: deleted by objectid", id);
            return res.status(200).json({ message: "Deleted", id: deleted._id });
          }
        }
      } catch (err) {
        console.debug("DELETE: objectid deletion failed", (err as Error).message);
      }

      // 2) try literal _id deletion
      try {
        const deletedLiteral = await ExtractedTask.findOneAndDelete({ _id: id });
        if (deletedLiteral) {
          console.info("DELETE: deleted by literal _id", id);
          return res.status(200).json({ message: "Deleted", id: deletedLiteral._id, fallback: "literal_id" });
        }
      } catch (err) {
        console.debug("DELETE: literal _id deletion failed", (err as Error).message);
      }

      // 3) fallback
      const fallback = await findTaskByIdOrFallback(id);
      if (fallback?.task) {
        const deleted2 = await ExtractedTask.findByIdAndDelete((fallback.task as any)._id);
        if (deleted2) {
          console.info("DELETE: deleted by fallback", fallback.reason, fallback.meta || {});
          return res.status(200).json({ message: "Deleted", id: deleted2._id, fallback: fallback.reason });
        }
      }

      return res.status(404).json({ error: "task not found", tried: ["objectid", "literal_id", "fallback"] });
    }

    return res.status(405).end();
  } catch (err: any) {
    console.error("Error in /api/extracted:", err);
    return res.status(500).json({ error: "Internal server error", details: err?.message || err });
  }
}
