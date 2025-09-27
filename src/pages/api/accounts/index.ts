// pages/api/accounts/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "@/lib/db";
import ExtractedAccount from "@/models/ExtractedAccount";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await connectDB();

  try {
    if (req.method === "GET") {
      // Return all accounts and their last processed email timestamp
      const accounts = await ExtractedAccount.find({});
      return res.status(200).json(accounts);
    }

    if (req.method === "POST") {
      // Create or update account
      const { email, lastEmailTs } = req.body;
      if (!email) {
        return res.status(400).json({ error: "email required" });
      }

      const account = await ExtractedAccount.findOneAndUpdate(
        { email },
        { $set: { lastEmailTs } },
        { upsert: true, new: true }
      );
      return res.status(201).json(account);
    }

    if (req.method === "PATCH") {
      const { email, lastEmailTs } = req.body;
      if (!email) {
        return res.status(400).json({ error: "email required" });
      }

      const account = await ExtractedAccount.findOneAndUpdate(
        { email },
        { $set: { lastEmailTs } },
        { new: true }
      );
      return res.status(200).json(account);
    }

    if (req.method === "DELETE") {
      const { email } = req.query;
      if (!email || typeof email !== "string") {
        return res.status(400).json({ error: "email query param required" });
      }

      await ExtractedAccount.findOneAndDelete({ email });
      return res.status(200).json({ message: "Deleted" });
    }

    return res.status(405).end();
  } catch (err: any) {
    console.error("Error in /api/accounts:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}