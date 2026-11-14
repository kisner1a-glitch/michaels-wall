"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

// Supabase client. The URL and key come from .env.local (we set that up in the Supabase step).
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

// Fixed name on every post (no login needed for this test)
const AUTHOR = "Michael";

// Shape of one row in the "posts" table
type Post = {
  id: number;
  name: string;
  message: string;
  image_url: string | null;
  created_at: string;
};

export default function Home() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true); // first load only
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [shareError, setShareError] = useState("");

  // Get all posts, newest first
  async function loadPosts() {
    const { data, error } = await supabase
      .from("posts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setLoadError("Couldn't load the Wall. Check your connection and try again.");
    } else {
      setPosts(data as Post[]);
      setLoadError("");
    }
    setLoading(false);
  }

  // Load the feed once when the page opens
  useEffect(() => {
    loadPosts();
  }, []);

  // Save a new post, then reload the feed
  async function handleShare() {
    const text = message.trim();

    if (!text) {
      setShareError("Write something first!");
      return;
    }

    setSending(true);
    setShareError("");

    const { error } = await supabase
      .from("posts")
      .insert({ name: AUTHOR, message: text });

    if (error) {
      setShareError("Couldn't share your post. Try again in a moment.");
    } else {
      setMessage("");
      await loadPosts();
    }
    setSending(false);
  }

  return (
    <div
      className="min-h-screen bg-[#e9e9e9] text-[12px] text-[#333]"
      style={{ fontFamily: "Tahoma, 'Lucida Grande', Verdana, sans-serif" }}
    >
      {/* Animation for new posts */}
      <style>{`
        @keyframes slidein {
          from { opacity: 0; transform: translateY(-12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Blue header bar */}
      <header className="border-b border-[#29447e] bg-[#3b5998]">
        <div className="mx-auto flex h-[42px] max-w-[640px] items-center px-3">
          <span className="text-[20px] font-bold tracking-tight text-white">
            {AUTHOR}&apos;s Wall
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[640px] px-3 py-4">
        {/* "Wall" tab */}
        <div className="inline-block rounded-t border border-b-0 border-[#d8dfea] bg-white px-4 py-1 font-bold text-[#3b5998]">
          Wall
        </div>

        {/* Input box */}
        <div className="border border-[#ccc] bg-white p-3">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Write something..."
            rows={3}
            className="w-full resize-none border border-[#bdc7d8] p-2 text-[12px] focus:border-[#3b5998] focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-[#cc0000]">{shareError}</span>
            <button
              onClick={handleShare}
              disabled={sending}
              className="border border-[#29447e] bg-[#5b74a8] px-4 py-[3px] font-bold text-white hover:bg-[#4f6899] disabled:opacity-60"
            >
              {sending ? "Sharing..." : "Share"}
            </button>
          </div>
        </div>

        {/* Feed */}
        <div className="mt-3 space-y-2">
          {loading && <p className="p-3 text-[#777]">Loading the Wall...</p>}

          {loadError && (
            <div className="border border-[#dd3c10] bg-[#ffebe8] p-3">
              {loadError}{" "}
              <button onClick={loadPosts} className="text-[#3b5998] underline">
                Try again
              </button>
            </div>
          )}

          {!loading && !loadError && posts.length === 0 && (
            <p className="border border-[#d8dfea] bg-white p-3 text-[#777]">
              Nothing here yet. Be the first to write on the Wall!
            </p>
          )}

          {posts.map((post) => (
            <div
              key={post.id}
              className="flex gap-3 border border-[#ccc] bg-white p-3 animate-[slidein_0.4s_ease-out]"
            >
              {/* Avatar: first letter of the name */}
              <div className="flex h-[50px] w-[50px] shrink-0 items-center justify-center border border-[#ccc] bg-[#d8dfea] text-[22px] font-bold text-[#3b5998]">
                {post.name.charAt(0)}
              </div>

              <div className="min-w-0 flex-1">
                <span className="font-bold text-[#3b5998]">{post.name}</span>
                <p className="mt-1 whitespace-pre-wrap break-words">{post.message}</p>
                <div className="mt-2 text-[11px] text-[#999]">
                  {new Date(post.created_at).toLocaleString()} ·{" "}
                  <span className="text-[#3b5998]">Comment</span> ·{" "}
                  <span className="text-[#3b5998]">Like</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
