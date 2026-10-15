# Onthousels

A quiet notes app: notes on tracing paper laid over a drafting grid, lettered by hand. Notes have an optional title and either free text or checkboxes, with bold and italic. A to-do list stays pinned at the top, labels file related notes together, and there's a light and a dark theme. You sign in with an email and password.

React + Vite + TypeScript, Supabase (Postgres, Auth), TipTap editor.

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**: paste [supabase/schema.sql](supabase/schema.sql) and run it. This creates the `notes`, `labels` and `note_labels` tables with Row Level Security, so each person only ever sees their own notes.
3. **Project Settings → API**: copy the Project URL and the `anon` / publishable key.

```sh
cp .env.example .env.local   # then paste the two values in
```

### 2. Email + password sign-in

Supabase's email login is on by default. Open **Authentication → Sign In / Providers → Email** to adjust it:

- **Confirm email**: when this is on, a new account must click a link in a confirmation email before it can sign in. Turn it off if this is just for you.
- **Allow new users to sign up** (under Authentication settings): once you've made your account, turn this off so nobody else can register on your deployed app.

If you leave email confirmation on, add your app's URL under **Authentication → URL Configuration → Redirect URLs** (`http://localhost:5173` for local work) so the confirmation link lands back in the app.

### 3. Run

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
```

To deploy, put `dist/` on any static host (Vercel, Netlify, Cloudflare Pages). Set the two `VITE_` env vars there, and add the deployed URL to Supabase's Site URL and redirect URLs. Make sure the host serves `sw.js` and `index.html` without long-lived caching, so updates reach installed copies.

### 4. Install on a phone

Onthousels is a PWA. Open the deployed (HTTPS) site and use **Install app** in Chrome on Android, or **Share → Add to Home Screen** in Safari on iOS. The service worker only runs over HTTPS or on `localhost`, so the `http://192.168…` dev address on your network won't install or work offline. `npm run build && npm run preview` gives a production-like build on localhost for checking offline behaviour.

The app icons in `public/` are generated from `public/favicon.svg`. After changing the favicon, run `npx pwa-assets-generator` to regenerate them.

## How it behaves

- **Writing**: tap *Write something…* (or the + button on a phone). Notes save themselves about a second after you pause, and when you press *Done*, press Esc, or click outside. A note left completely empty is discarded.
- **Text ↔ checkboxes**: the *Text / List* switch converts each line into a checkbox and back. Formatting survives the switch. Tick state is dropped when going back to text.
- **Formatting**: Ctrl/⌘+B and Ctrl/⌘+I, or the B and I buttons (useful on phones). Ctrl+U for underline also works.
- **Labels**: the tag button in a note finds or creates labels. The sidebar filters by label, and *Edit* renames or deletes them. Deleting a label keeps its notes. A new note started while you're viewing a label gets that label.
- **To do**: one checklist is always pinned at the top. Tick items straight from it, tap it to add or edit items, and use *Clear done* to sweep away ticked items (with undo). It can't be deleted, and it isn't counted among your notes.
- **Text / Lists filter**: the *All · Text · Lists* switch above the notes shows only text notes, only checklists, or both. It remembers your choice on that device.
- **Collage**: notes sit newest-first and stay in place when you edit them, so the desk doesn't reshuffle under you. You can tick checkboxes straight from a card.
- **Deleting**: use the trash icon on a card (on hover) or in the editor. You can undo for a few seconds afterwards.
- **Sync**: the app reloads your notes when you come back to the tab, so changes made on another device show up.
- **Offline**: the app opens and works without a connection. Your notes come from a copy kept on the device, and everything you write, delete or label waits in an outbox on the device until the connection returns. Then it's sent in order. The top bar says *Offline* while that's the case. If the same note was edited on two devices, the last save wins.
- **Updates**: when a new version has been deployed, a note offers *Reload*. It never reloads by itself mid-sentence.
- **Signing out**: this clears the copy on the device. If changes are still waiting to sync, it asks first. Signing out needs a connection.

## Layout

```
src/
  App.tsx               auth gate (setup → login → home)
  hooks/useNotes.ts     data store: optimistic updates, on-device copy, writes via the outbox
  hooks/useTheme.ts     light/dark, follows the system until you choose
  lib/doc.ts            note-document helpers (text↔checklist, search text)
  lib/outbox.ts         writes kept on the device and sent in order, retried while offline
  lib/offline.ts        IndexedDB copy of notes/labels and outbox; last signed-in user
  lib/hashtags.ts       "#tag" while writing → label
  components/
    Home.tsx            top bar, collage, editor orchestration
    NoteCard.tsx        a note on the desk
    PinnedTodo.tsx      the to-do list pinned above the collage
    NoteRenderer.tsx    renders note JSON safely (no innerHTML)
    NoteEditor.tsx      TipTap editor sheet (lazy-loaded)
    LabelPicker.tsx     find/create/toggle labels in a note
    Sidebar.tsx         label filter + label management + sign out
  styles.css            the drafting grid, tracing paper and hand lettering
supabase/schema.sql
```
