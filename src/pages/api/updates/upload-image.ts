import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import { getSupabaseAdmin } from "../../../utils/database";

const MAX_SIZE_MB = 8;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;

  const formData = await context.request.formData().catch(() => null);
  const file = formData?.get("image") as File | null;

  if (!file) return json({ error: "No image provided." }, 400);
  if (!ALLOWED_TYPES.includes(file.type)) return json({ error: "Unsupported image type." }, 400);
  if (file.size > MAX_SIZE_MB * 1024 * 1024) return json({ error: `Image must be under ${MAX_SIZE_MB}MB.` }, 400);

  const ext = file.type.split("/")[1].replace("jpeg", "jpg");
  const path = `updates/${crypto.randomUUID()}.${ext}`;

  const db = getSupabaseAdmin();
  const bytes = await file.arrayBuffer();

  const { error: uploadError } = await db.storage
    .from("update-images")
    .upload(path, bytes, { contentType: file.type, upsert: false });

  if (uploadError) {
    console.error("[updates/upload-image] storage error:", JSON.stringify(uploadError));
    return json({ error: "Upload failed." }, 500);
  }

  const { data: { publicUrl } } = db.storage.from("update-images").getPublicUrl(path);

  return json({ url: publicUrl });
};
