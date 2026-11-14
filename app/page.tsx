"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { createClient } from "@supabase/supabase-js";

// Supabase client. URL and key come from .env.local (and from Vercel when deployed).
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

// ---------- Settings ----------
const MAX = 280; // max characters in a post or comment (the database enforces it too)
const MAX_FILE_MB = 20; // same limit as the Storage bucket
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
];

// Reactions are stored as words in the database and shown as emojis here
const REACTIONS = [
  { key: "like", emoji: "👍", label: "Like" },
  { key: "love", emoji: "❤️", label: "Love" },
  { key: "haha", emoji: "😂", label: "Haha" },
  { key: "wow", emoji: "😮", label: "Wow" },
  { key: "sad", emoji: "😢", label: "Sad" },
  { key: "angry", emoji: "😡", label: "Angry" },
];

// ---------- Types (one per table) ----------
type Post = {
  id: number;
  name: string;
  message: string;
  image_url: string | null; // holds a photo OR a video link
  media_type: "image" | "video" | null;
  created_at: string;
};
type Comment = { id: number; post_id: number; name: string; message: string; created_at: string };
type Reaction = { id: number; post_id: number; reaction: string };
type ProfileInfo = {
  name: string;
  tagline: string;
  networks: string | null;
  current_city: string | null;
};
type Profile = ProfileInfo & { avatar_url: string | null };

const DEFAULT_PROFILE: Profile = {
  name: "Michael",
  tagline: "wall",
  networks: null,
  current_city: null,
  avatar_url: null,
};

// ---------- Small helpers ----------

// "now", "5m", "2h", "3d"
function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

// Returns an error message, or "" if the file is OK
function checkFile(file: File, photoOnly = false) {
  const allowed = photoOnly ? ALLOWED_TYPES.filter((t) => t.startsWith("image/")) : ALLOWED_TYPES;
  if (!allowed.includes(file.type)) {
    return photoOnly
      ? "Please choose a JPG, PNG, GIF or WebP photo."
      : "Please choose a JPG, PNG, GIF or WebP photo, or an MP4 or WebM video.";
  }
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    return `That file is too big. The limit is ${MAX_FILE_MB} MB.`;
  }
  return "";
}

// Upload a file to the public "media" bucket and return its public link
async function uploadFile(file: File, folder: string) {
  const ext = file.type.split("/")[1]; // jpeg, png, mp4, ...
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("media").upload(path, file, {
    contentType: file.type,
  });
  if (error) throw error;
  return supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
}

// Turns a chosen file into a temporary link the browser can preview
function useObjectUrl(file: File | null) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) {
      setUrl("");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl); // clean up the old link
  }, [file]);
  return url;
}

const inputClass =
  "w-full border border-[#bdc7d8] p-1 text-[12px] focus:border-[#3b5998] focus:outline-none";
const grayButton =
  "border border-[#999] bg-[#f2f2f2] px-3 py-[3px] hover:bg-[#e6e6e6] disabled:cursor-not-allowed disabled:opacity-60";
const blueButton =
  "border border-[#29447e] bg-[#5b74a8] px-3 py-[3px] font-bold text-white hover:bg-[#4f6899] disabled:cursor-not-allowed disabled:opacity-60";

export default function Home() {
  // Data from Supabase
  const [posts, setPosts] = useState<Post[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);

  // Page status
  const [loading, setLoading] = useState(true); // first load only
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState(""); // small "done!" message
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // New post box
  const [message, setMessage] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [previewReady, setPreviewReady] = useState(false); // true once the preview has fully loaded
  const [sending, setSending] = useState(false);
  const [shareError, setShareError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaPreview = useObjectUrl(mediaFile);

  // Profile
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", tagline: "", networks: "", city: "" });
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarReady, setAvatarReady] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const avatarPreview = useObjectUrl(avatarFile);
  const avatarSrc = avatarPreview || profile.avatar_url; // show the preview first, if there is one

  // Reactions and comments UI
  const [pickerFor, setPickerFor] = useState<number | null>(null); // which post has the emoji popup open
  const [openComments, setOpenComments] = useState<Record<number, boolean>>({});
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  // Share only works when there is text and, if media is attached, its preview has finished loading
  const hasContent = message.trim().length > 0 || !!mediaFile;
  const canShare = !sending && hasContent && (!mediaFile || previewReady);
  const shareHint =
    mediaFile && !previewReady
      ? "Waiting for the preview to finish..."
      : mediaFile && !message.trim()
        ? "Message is optional. You can share the media on its own."
        : "";

  // ---------- Small UI helpers ----------
  function showToast(text: string) {
    clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  }

  // ---------- Load everything ----------
  async function loadAll() {
    const [postsRes, commentsRes, reactionsRes, profileRes] = await Promise.all([
      supabase.from("posts").select("*").order("created_at", { ascending: false }),
      supabase.from("comments").select("*").order("created_at", { ascending: true }),
      supabase.from("reactions").select("id, post_id, reaction"),
      supabase.from("profiles").select("*").order("created_at", { ascending: false }).limit(1),
    ]);

    if (postsRes.error || commentsRes.error || reactionsRes.error || profileRes.error) {
      setLoadError("Couldn't load the Wall. Check your connection and try again.");
    } else {
      setPosts(postsRes.data as Post[]);
      setComments(commentsRes.data as Comment[]);
      setReactions(reactionsRes.data as Reaction[]);
      // newest profile row = current profile
      setProfile((profileRes.data?.[0] as Profile | undefined) ?? DEFAULT_PROFILE);
      setLoadError("");
    }
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  // ---------- New post ----------
  function pickMedia(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets you pick the same file again later
    if (!file) return;
    const problem = checkFile(file);
    if (problem) {
      setShareError(problem);
      return;
    }
    setShareError("");
    setPreviewReady(false); // wait for the new preview to load
    setMediaFile(file);
  }

  function removeMedia() {
    setMediaFile(null);
    setPreviewReady(false);
  }

  function previewFailed() {
    setShareError("Couldn't preview that file. Try a different one.");
    removeMedia();
  }

  async function handleShare() {
    const text = message.trim();
    if (!text && !mediaFile) {
      setShareError("Write something or add a photo/video first!");
      return;
    }

    setSending(true);
    setShareError("");

    try {
      // 1. Upload the photo/video first (if there is one)
      let image_url: string | null = null;
      let media_type: "image" | "video" | null = null;
      if (mediaFile) {
        image_url = await uploadFile(mediaFile, "posts");
        media_type = mediaFile.type.startsWith("video/") ? "video" : "image";
      }

      // 2. Save the post
      const { error } = await supabase
        .from("posts")
        .insert({ name: profile.name, message: text, image_url, media_type });
      if (error) throw error;

      setMessage("");
      removeMedia();
      showToast("✓ Posted to your Wall");
      await loadAll();
    } catch (err) {
      console.error("Share failed:", err);
      const reason = (err as { message?: string })?.message;
      setShareError(
        reason ? `Couldn't share: ${reason}` : "Couldn't share your post. Try again in a moment."
      );
    }
    setSending(false);
  }

  // ---------- Profile ----------
  function startEdit() {
    setForm({
      name: profile.name,
      tagline: profile.tagline,
      networks: profile.networks ?? "",
      city: profile.current_city ?? "",
    });
    setProfileError("");
    setEditing(true);
  }

  function pickAvatar(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const problem = checkFile(file, true);
    if (problem) {
      setProfileError(problem);
      return;
    }
    setProfileError("");
    setAvatarReady(false); // wait for the new preview to load
    setAvatarFile(file);
  }

  function cancelPhoto() {
    setAvatarFile(null);
    setAvatarReady(false);
  }

  // Saves the profile by inserting a NEW row (visitors can only insert, never update or delete)
  async function saveProfileRow(info: ProfileInfo) {
    setSavingProfile(true);
    setProfileError("");

    try {
      let avatar_url = profile.avatar_url;
      if (avatarFile) avatar_url = await uploadFile(avatarFile, "avatars");

      const { error } = await supabase.from("profiles").insert({ ...info, avatar_url });
      if (error) throw error;

      cancelPhoto();
      setEditing(false);
      showToast("✓ Profile saved");
      await loadAll();
    } catch {
      setProfileError("Couldn't save your profile. Try again in a moment.");
    }
    setSavingProfile(false);
  }

  // "Save photo" button: keep the text as it is, change only the photo
  function savePhoto() {
    saveProfileRow({
      name: profile.name,
      tagline: profile.tagline,
      networks: profile.networks,
      current_city: profile.current_city,
    });
  }

  // "Save" button in the Edit info form
  function saveInfo() {
    saveProfileRow({
      name: form.name.trim() || "Michael",
      tagline: form.tagline.trim(),
      networks: form.networks.trim() || null,
      current_city: form.city.trim() || null,
    });
  }

  // ---------- Reactions and comments ----------
  async function react(postId: number, reaction: string, emoji: string) {
    setPickerFor(null);
    setActionError("");
    const { error } = await supabase.from("reactions").insert({ post_id: postId, reaction });
    if (error) {
      setActionError("Couldn't save your reaction. Try again.");
      return;
    }
    showToast(`✓ You reacted ${emoji}`);
    await loadAll();
  }

  function toggleComments(postId: number) {
    setOpenComments((open) => ({ ...open, [postId]: !open[postId] }));
  }

  async function addComment(postId: number) {
    const text = (drafts[postId] ?? "").trim();
    if (!text) {
      setActionError("Write a comment first!");
      return;
    }
    setActionError("");
    const { error } = await supabase.from("comments").insert({ post_id: postId, message: text });
    if (error) {
      setActionError("Couldn't post your comment. Try again.");
      return;
    }
    setDrafts((d) => ({ ...d, [postId]: "" }));
    showToast("✓ Comment posted");
    await loadAll();
  }

  // ---------- Page ----------
  return (
    <div
      className="min-h-screen bg-[#e9e9e9] text-[12px] text-[#333]"
      style={{ fontFamily: "Tahoma, 'Lucida Grande', Verdana, sans-serif" }}
    >
      {/* Animations: posts slide in, popups pop, and every button gets a "pressed" effect */}
      <style>{`
        @keyframes slidein {
          from { opacity: 0; transform: translateY(-12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pop {
          from { opacity: 0; transform: scale(0.8); }
          to   { opacity: 1; transform: scale(1); }
        }
        button {
          transition: transform 0.1s, scale 0.1s, filter 0.1s, box-shadow 0.1s;
        }
        button:active:not(:disabled) {
          transform: scale(0.92);
          filter: brightness(0.8);
          box-shadow: 0 0 0 3px rgba(59, 89, 152, 0.35);
        }
      `}</style>

      {/* Blue header bar */}
      <header className="border-b border-[#29447e] bg-[#3b5998]">
        <div className="mx-auto flex h-[42px] max-w-[900px] items-center px-3">
          <span className="text-[20px] font-bold tracking-tight text-white">
            {`${profile.name}'s Wall`}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[900px] px-3 py-4">
        <div className="flex flex-col border border-[#ccc] bg-white md:flex-row">
          {/* ---------- Left sidebar: profile ---------- */}
          <aside className="w-full shrink-0 border-b border-[#ccc] p-4 md:w-[220px] md:border-b-0 md:border-r">
            {/* Avatar frame (shows a preview as soon as you choose a photo) */}
            <div className="flex aspect-square w-full max-w-[220px] items-center justify-center overflow-hidden border border-[#ccc] bg-[#d8dfea] text-[64px] font-bold text-[#3b5998]">
              {avatarSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={avatarSrc}
                  src={avatarSrc}
                  alt={`${profile.name}'s profile photo`}
                  onLoad={() => {
                    if (avatarPreview) setAvatarReady(true);
                  }}
                  onError={() => {
                    if (avatarPreview) {
                      setProfileError("Couldn't preview that photo. Try a different one.");
                      cancelPhoto();
                    }
                  }}
                  className="h-full w-full object-cover"
                />
              ) : (
                profile.name.charAt(0)
              )}
            </div>

            {/* Upload button right under the photo */}
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={pickAvatar}
              className="hidden"
            />
            {avatarFile ? (
              <div className="mt-2 max-w-[220px]">
                <div className="flex gap-2">
                  <button
                    onClick={savePhoto}
                    disabled={savingProfile || !avatarReady}
                    className={blueButton}
                  >
                    {savingProfile ? "Saving..." : avatarReady ? "Save photo" : "Loading..."}
                  </button>
                  <button onClick={cancelPhoto} disabled={savingProfile} className={grayButton}>
                    Cancel
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-[#777]">Preview only. Not saved yet.</p>
              </div>
            ) : (
              <button
                onClick={() => avatarInputRef.current?.click()}
                className={`mt-2 w-full max-w-[220px] ${grayButton}`}
              >
                📷 Change photo
              </button>
            )}
            {profileError && <p className="mt-1 text-[11px] text-[#cc0000]">{profileError}</p>}

            {editing ? (
              <div className="mt-3 space-y-2">
                <label className="block">
                  <span className="font-bold">Name</span>
                  <input
                    value={form.name}
                    maxLength={50}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="font-bold">Tagline</span>
                  <input
                    value={form.tagline}
                    maxLength={80}
                    onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="font-bold">Networks</span>
                  <input
                    value={form.networks}
                    maxLength={100}
                    onChange={(e) => setForm({ ...form, networks: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="font-bold">Current city</span>
                  <input
                    value={form.city}
                    maxLength={100}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <div className="flex gap-2">
                  <button onClick={saveInfo} disabled={savingProfile} className={blueButton}>
                    {savingProfile ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    disabled={savingProfile}
                    className={grayButton}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h2 className="mt-3 text-[18px] font-bold">{profile.name}</h2>
                <p className="text-[#777]">{profile.tagline}</p>
                <button onClick={startEdit} className={`mt-3 ${grayButton}`}>
                  Edit info
                </button>
                {profile.networks && (
                  <div className="mt-4">
                    <div className="font-bold">Networks</div>
                    <div className="text-[#555]">{profile.networks}</div>
                  </div>
                )}
                {profile.current_city && (
                  <div className="mt-3">
                    <div className="font-bold">Current city</div>
                    <div className="text-[#555]">{profile.current_city}</div>
                  </div>
                )}
              </>
            )}
          </aside>

          {/* ---------- Right column: post box + feed ---------- */}
          <section className="min-w-0 flex-1 p-4">
            {/* New post box */}
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What's on your mind?"
              rows={3}
              maxLength={MAX}
              className="w-full resize-none border border-[#bdc7d8] p-2 text-[12px] focus:border-[#3b5998] focus:outline-none"
            />
            <div
              className={`mt-1 text-[11px] ${
                MAX - message.length <= 20 ? "text-[#cc0000]" : "text-[#777]"
              }`}
            >
              {MAX - message.length} characters remaining
            </div>

            {/* Preview of the photo/video you picked */}
            {mediaFile && mediaPreview && (
              <div className="mt-2 inline-block max-w-full border border-[#ccc] bg-[#f7f7f7] p-2">
                {mediaFile.type.startsWith("video/") ? (
                  <video
                    key={mediaPreview}
                    src={mediaPreview}
                    controls
                    muted
                    onLoadedData={() => setPreviewReady(true)}
                    onError={previewFailed}
                    className="max-h-[200px] max-w-full"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={mediaPreview}
                    src={mediaPreview}
                    alt="Preview of the photo you are sharing"
                    onLoad={() => setPreviewReady(true)}
                    onError={previewFailed}
                    className="max-h-[200px] max-w-full"
                  />
                )}
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={MAX}
                  placeholder="Add a caption (optional)..."
                  className={`mt-2 ${inputClass}`}
                />
                <div className="mt-1 flex items-center gap-2 text-[11px] text-[#555]">
                  <span className="max-w-[200px] truncate">{mediaFile.name}</span>
                  <span className={previewReady ? "text-[#2e7d32]" : ""}>
                    {previewReady ? "✓ Ready" : "Loading preview..."}
                  </span>
                  <button onClick={removeMedia} className="text-[#cc0000] underline">
                    remove
                  </button>
                </div>
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {/* Hidden file input, opened by the button below */}
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_TYPES.join(",")}
                onChange={pickMedia}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
                className={grayButton}
              >
                📎 Photo / Video
              </button>
              <span className="basis-full text-[11px] text-[#cc0000] sm:basis-auto">{shareError}</span>
              {!shareError && <span className="text-[11px] text-[#777]">{shareHint}</span>}
              <button onClick={handleShare} disabled={!canShare} className={`ml-auto px-4 ${blueButton}`}>
                {sending ? "Sharing..." : "Share"}
              </button>
            </div>

            {/* Feed */}
            <div className="mt-4">
              {loading && <p className="py-3 text-[#777]">Loading the Wall...</p>}

              {loadError && (
                <div className="border border-[#dd3c10] bg-[#ffebe8] p-3">
                  {loadError}{" "}
                  <button onClick={loadAll} className="text-[#3b5998] underline">
                    Try again
                  </button>
                </div>
              )}

              {actionError && (
                <div className="mb-2 border border-[#dd3c10] bg-[#ffebe8] p-2">{actionError}</div>
              )}

              {!loading && !loadError && posts.length === 0 && (
                <p className="border-t border-[#e5e5e5] py-3 text-[#777]">
                  Nothing here yet. Be the first to write on the Wall!
                </p>
              )}

              {posts.map((post) => {
                const postComments = comments.filter((c) => c.post_id === post.id);
                const counts: Record<string, number> = {};
                reactions
                  .filter((r) => r.post_id === post.id)
                  .forEach((r) => {
                    counts[r.reaction] = (counts[r.reaction] ?? 0) + 1;
                  });

                return (
                  <article
                    key={post.id}
                    className="animate-[slidein_0.4s_ease-out] border-t border-[#e5e5e5] py-3"
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="font-bold text-[#3b5998]">{post.name}</span>
                      <span
                        className="text-[11px] text-[#999]"
                        title={new Date(post.created_at).toLocaleString()}
                      >
                        {timeAgo(post.created_at)}
                      </span>
                    </div>

                    {post.message && (
                      <p className="mt-1 whitespace-pre-wrap break-words">{post.message}</p>
                    )}

                    {/* Photo or video */}
                    {post.image_url && post.media_type === "video" && (
                      <video
                        src={post.image_url}
                        controls
                        className="mt-2 max-h-[360px] max-w-full"
                      />
                    )}
                    {post.image_url && post.media_type !== "video" && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={post.image_url}
                        alt={`Photo shared by ${post.name}`}
                        className="mt-2 max-h-[360px] max-w-full border border-[#ccc]"
                      />
                    )}

                    {/* Reaction totals, e.g. 👍 2  ❤️ 1 */}
                    {Object.keys(counts).length > 0 && (
                      <div className="mt-2 text-[11px] text-[#555]">
                        {REACTIONS.filter((r) => counts[r.key]).map((r) => (
                          <span key={r.key} className="mr-3">
                            {r.emoji} {counts[r.key]}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Like + Comment buttons */}
                    <div className="mt-2 flex items-center gap-3 text-[11px]">
                      <div className="relative">
                        <button
                          onClick={() => setPickerFor(pickerFor === post.id ? null : post.id)}
                          className="text-[#3b5998] hover:underline"
                        >
                          Like
                        </button>
                        {pickerFor === post.id && (
                          <div className="absolute bottom-full left-0 z-10 mb-1 flex animate-[pop_0.15s_ease-out] gap-1 rounded-full border border-[#ccc] bg-white px-2 py-1 shadow-md">
                            {REACTIONS.map((r) => (
                              <button
                                key={r.key}
                                onClick={() => react(post.id, r.key, r.emoji)}
                                title={r.label}
                                className="text-[22px] hover:scale-125"
                              >
                                {r.emoji}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className="text-[#999]">·</span>
                      <button
                        onClick={() => toggleComments(post.id)}
                        className="text-[#3b5998] hover:underline"
                      >
                        Comment{postComments.length > 0 ? ` (${postComments.length})` : ""}
                      </button>
                    </div>

                    {/* Comments */}
                    {openComments[post.id] && (
                      <div className="mt-2 border border-[#e5e5e5] bg-[#f7f7f7] p-2">
                        {postComments.map((c) => (
                          <div key={c.id} className="mb-2 break-words">
                            <span className="font-bold text-[#3b5998]">{c.name}</span> {c.message}{" "}
                            <span className="text-[11px] text-[#999]">{timeAgo(c.created_at)}</span>
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <input
                            value={drafts[post.id] ?? ""}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [post.id]: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") addComment(post.id);
                            }}
                            maxLength={MAX}
                            placeholder="Write a comment..."
                            className={inputClass}
                          />
                          <button
                            onClick={() => addComment(post.id)}
                            className={`shrink-0 ${blueButton}`}
                          >
                            Comment
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </main>

      {/* "Done!" message after an action succeeds */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-50 animate-[pop_0.2s_ease-out] border border-[#3b5998] bg-white px-3 py-2 font-bold text-[#3b5998] shadow-md"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
