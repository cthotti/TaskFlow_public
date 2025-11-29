import mongoose, { Schema, model, models } from "mongoose";

export interface IExtractedAccount {
  email: string;
  lastEmailTs?: string | null; 
  updatedAt?: Date;
}

const ExtractedAccountSchema = new Schema<IExtractedAccount>(
  {
    email: { type: String, required: true, unique: true },
    lastEmailTs: { type: String, default: null },
  },
  { timestamps: true }
);

export default models.ExtractedAccount || model<IExtractedAccount>("ExtractedAccount", ExtractedAccountSchema);
