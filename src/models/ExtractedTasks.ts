// src/models/ExtractedTask.ts
import mongoose, { Schema, model, models } from "mongoose";

export interface IExtractedTask {
  title: string;
  description?: string;
  date?: string | null; // YYYY-MM-DD or null
  time?: string | null; // HH:MM or null
  source_subject?: string;
  source_from?: string;
  confidence?: number;
  _source_account?: string; // account email or "all_accounts"
  source_email_ts?: string; // ISO timestamp of the source email (used for dedupe)
  addedToCalendar?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const ExtractedTaskSchema = new Schema<IExtractedTask>(
  {
    title: { type: String, required: true },
    description: { type: String },
    date: { type: String, default: null },
    time: { type: String, default: null },
    source_subject: { type: String, default: "" },
    source_from: { type: String, default: "" },
    confidence: { type: Number, default: 0.9 },
    _source_account: { type: String, default: "all_accounts" },
    source_email_ts: { type: String, default: null },
    addedToCalendar: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// create a helpful index for dedupe lookups
ExtractedTaskSchema.index(
  { _source_account: 1, title: 1, source_subject: 1, source_email_ts: 1 },
  { unique: false }
);

export default models.ExtractedTask || model<IExtractedTask>("ExtractedTask", ExtractedTaskSchema);
