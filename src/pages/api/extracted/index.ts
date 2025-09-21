// pages/api/extracted/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "@/lib/db";
import ExtractedTask from "@/models/ExtractedTasks";

/**
 * API for extracted tasks used by the frontend.
 * Supports:
 *  - GET                -> return all tasks
 *  - POST               -> create a single task (or ingest many with action=ingest)
 *  - PATCH              -> update a task (e.g. mark addedToCalendar)
 *  - DELETE             -> delete a task by id
 *
 * Extended: POST?action=ingest or body.action === "ingest"
 *   - Accepts either:
 *       { tasks: [ { ...task } ] }          // array of task objects
 *     or
 *       { accounts: { "email@example.com": [ { ...task } ] } } // mapping produced by FastAPI
 *   - Upserts tasks using a de-dupe key (source_email_ts + _source_account) where available.
 */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await connectDB();

  try {
    // GET -> return all tasks
    if (req.method === "GET") {
      const tasks = await ExtractedTask.find({}).sort({ createdAt: -1 }).lean();
      return res.status(200).json(tasks);
    }

    // POST -> create a task OR ingest many (action=ingest)
    if (req.method === "POST") {
      const action = (req.query.action as string) || (req.body && req.body.action);
      // Ingest mode: accept tasks array OR accounts mapping
      if (action === "ingest") {
        const { tasks, accounts } = req.body || {};

        // Normalize input into an array of tasks
        let ingestTasks: any[] = [];

        if (Array.isArray(tasks)) {
          ingestTasks = tasks;
        } else if (accounts && typeof accounts === "object") {
          // accounts: { email: [task, ...], ... }
          for (const [email, tarr] of Object.entries(accounts)) {
            if (Array.isArray(tarr)) {
              for (const t of tarr) {
                // ensure _source_account is present
                ingestTasks.push({ ...(t as any), _source_account: (t as any)._source_account || email });
              }
            }
          }
        } else {
          return res.status(400).json({ error: "ingest requires body.tasks array or body.accounts mapping" });
        }

        // Upsert each task by (_source_account, source_email_ts) where possible; else create new
        const results = [];
        for (const t of ingestTasks) {
          try {
            // Normalize fields that your Mongoose model expects
            const doc = {
              title: t.title || t.subject || "(no title)",
              description: t.description || t.content || "",
              date: t.date || t.due || null,
              time: t.time || null,
              source_subject: t.source_subject || t.subject || null,
              source_from: t.source_from || t.from || null,
              confidence: typeof t.confidence === "number" ? t.confidence : (t.confidence ? Number(t.confidence) : 1.0),
              addedToCalendar: !!t.addedToCalendar,
              _source_account: t._source_account || t.account || null,
              source_email_ts: t.source_email_ts || t.source_ts || null,
            };

            // Build upsert filter
            let filter: any = null;
            if (doc._source_account && doc.source_email_ts) {
              filter = { _source_account: doc._source_account, source_email_ts: doc.source_email_ts };
            } else if (t._id) {
              filter = { _id: t._id };
            } else {
              // fallback: insert new unique doc (no reliable de-dupe key)
              filter = null;
            }

            let upserted;
            if (filter) {
              upserted = await ExtractedTask.findOneAndUpdate(filter, { $set: doc }, { upsert: true, new: true, setDefaultsOnInsert: true });
            } else {
              upserted = await ExtractedTask.create(doc);
            }
            results.push(upserted);
          } catch (err) {
            // continue ingesting others
            console.error("ingest task failed:", err);
          }
        }

        return res.status(201).json({ inserted: results.length, results });
      }

      // Regular POST: create a single task
      const { title, description, date, time, source_subject, source_from, confidence, _source_account, source_email_ts } = req.body;
      if (!title) {
        return res.status(400).json({ error: "title required" });
      }
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

    // PATCH -> update task fields (commonly used to set addedToCalendar)
    if (req.method === "PATCH") {
      const { id, addedToCalendar, ...rest } = req.body;
      if (!id) {
        return res.status(400).json({ error: "id required in body" });
      }
      const updates: any = {};
      if (typeof addedToCalendar !== "undefined") updates.addedToCalendar = !!addedToCalendar;
      // merge any other allowed fields
      for (const k of ["title", "description", "date", "time", "source_subject", "source_from", "confidence", "_source_account", "source_email_ts"]) {
        if (typeof (rest as any)[k] !== "undefined") updates[k] = (rest as any)[k];
      }
      const task = await ExtractedTask.findByIdAndUpdate(id, updates, { new: true });
      if (!task) return res.status(404).json({ error: "task not found" });
      return res.status(200).json(task);
    }

    // DELETE -> delete by id
    if (req.method === "DELETE") {
      const id = req.query.id as string | undefined;
      if (!id) return res.status(400).json({ error: "id query param required" });
      await ExtractedTask.findByIdAndDelete(id);
      return res.status(200).json({ message: "Deleted" });
    }

    return res.status(405).end();
  } catch (err: any) {
    console.error("Error in /api/extracted:", err);
    return res.status(500).json({ error: "Internal server error", details: err?.message || String(err) });
  }
}
