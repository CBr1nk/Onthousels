# Onthousels

A quiet notes app: notes on tracing paper laid over a drafting grid, lettered by hand. Notes have an optional title and either free text or checkboxes, with bold and italic. Lists and pages you keep coming back to stay pinned at the top as tabs, labels file related notes together, and there's a light and a dark theme. Personal and Work keep two separate desks, and a note can be shared with a friend so you both write in it at once. You sign in with an email and password.

React + Vite + TypeScript, Supabase (Postgres, Auth, Realtime), TipTap editor, Yjs for editing together.

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**: paste [supabase/schema.sql](supabase/schema.sql) and run it. This creates the `notes`, `labels`, `note_labels`, `friendships` and `note_shares` tables with Row Level Security, so each person only sees their own notes and the ones shared with them. It also sets up the private Realtime channels used for live updates. The script is safe to run again: on a project made with an earlier version it adds what's missing (run it again after updating).
3. **Project Settings → API**: copy the Project URL and the `anon` / publishable key.

```sh
cp .env.example .env.local   # then paste the two values in
```

### 2. Email + password sign-in

Supabase's email login is on by default. Open **Authentication → Sign In / Providers → Email** to adjust it:

- **Confirm email**: when this is on, a new account must click a link in a confirmation email before it can sign in. Turn it off if this is just for you.
- **Allow new users to sign up** (under Authentication settings): once you've made your account, turn this off so nobody else can register on your deployed app. Friends need an account to accept a request, so either invite them from **Authentication → Users → Invite user** or turn sign-ups on while they register.
- Keep **Confirm email** on if anyone but you can sign up: a friend request is found by email address, so the address should be proven to belong to whoever signs in with it.

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

- **Writing**: tap *Write something…* (or the + button on a phone). Notes save themselves about a second after you pause, and when you press *Done*, press Esc, or click outside. A note left completely empty is discarded. Tapping anywhere on the page below the text carries on writing at the end. On a phone the note fills the visible screen, and while the keyboard is up the toolbar sits just above it.
- **Text ↔ checkboxes**: the *Text / List* switch converts each line into a checkbox and back. Formatting survives the switch. Tick state is dropped when going back to text.
- **Formatting**: Ctrl/⌘+B and Ctrl/⌘+I, or the B and I buttons (useful on phones). Ctrl+U for underline also works.
- **Labels**: the tag button in a note finds or creates labels. The sidebar filters by label, and *Edit* renames or deletes them. Deleting a label keeps its notes. A new note started while you're viewing a label gets that label.
- **Personal / Work**: the switch in the top bar (icons only on a phone) flips between two desks. Each has its own notes, labels and pinned tabs. The app remembers which one you were on, per device.
- **Pinned tabs**: notes pinned above the desk as tabs. The *+* at the end of the tabs adds one: give it a name, choose *List* (checkboxes) or *Note* (free text), and tick any friends to share it with. Tap a tab's page to edit it; in the editor you can rename it (the title is the tab's name), switch it between list and note, share it or stop sharing, and delete it (with undo). The pencil beside the tabs opens *Arrange*: rename tabs, move them up and down, and delete them (a friend's tab is only removed from your desk). Your order is your own; a friend arranges their tabs separately. Tick items straight from a list, and *Clear done* sweeps away ticked items (with undo). Tabs aren't counted among your notes. Each desk (Personal, Work) has its own.
- **Pages**: a note can hold pages, for planning something bigger: a *Camping trip* note with *Things to pack* and *Groceries* checklists and a *Route* page. Start one with the pages button beside a note's title (or the *+* at the end of its pages); each page is a list or a note of its own. The note's own text stays as the first page, *Overview*. The pencil beside the pages renames, reorders and deletes them (with undo). Sharing the note shares all its pages, and anyone it's shared with can add, edit and arrange them; each page is edited together live like any shared note. The card shows how many pages a note holds, and search looks inside them. Pages go one level deep.
- **Mine / Shared**: the switch at the top of the tabs flips between the tabs only you see and the ones shared with friends, yours and theirs, e.g. a family shopping list. Sharing a tab, or stopping, moves it across. A friend's tab shows their name after it. The app remembers which side and tab were open, per device.
- **Text / Lists filter**: the *All · Text · Lists* switch above the notes shows only text notes, only checklists, or both. It remembers your choice on that device.
- **Collage**: notes sit newest-first and stay in place when you edit them, so the desk doesn't reshuffle under you. You can tick checkboxes straight from a card.
- **Deleting**: use the trash icon on a card (on hover) or in the editor. You can undo for a few seconds afterwards.
- **Friends**: open *Friends* in the menu, give a name (e.g. Lisa) and an email address, and send a request. No email is sent: the request waits in the app for whoever signs in with that address, and they can accept (naming you however they like) or decline. Names are your own and can be changed at any time. Removing a friend stops sharing between you.
- **Sharing**: the people button in a note shares it with friends (any note, tabs included). A shared note shows *with Lisa* on your card and *from you* (by the name Lisa gave you) on hers, in the same space you keep it in. Only the owner can delete it; a friend can remove it from their own notes. Each person files it under their own labels.
- **Writing together**: while a shared note is open on both sides, each sees the other's typing as it happens, with their caret and name, and edits made at the same moment merge rather than overwrite. Title, text, ticks and the Text/List switch all sync. Underneath, the open note is a Yjs document passed between you over a private Supabase Realtime channel; the note itself is still saved as before.
- **Sync**: changes from your other devices and from friends arrive live, and the app also reloads your notes when you come back to the tab.
- **Offline**: the app opens and works without a connection. Your notes come from a copy kept on the device, and everything you write, delete or label waits in an outbox on the device until the connection returns. Then it's sent in order. The top bar says *Offline* while that's the case. If the same note was edited on two devices while one of them was offline (or outside the open editor, like ticking a box on a card), the last save wins.
- **Updates**: when a new version has been deployed, a note offers *Reload*. It never reloads by itself mid-sentence.
- **Signing out**: this clears the copy on the device. If changes are still waiting to sync, it asks first. Signing out needs a connection.

## Layout

```
src/
  App.tsx               auth gate (setup → login → home)
  hooks/useNotes.ts     data store: optimistic updates, on-device copy, writes via the outbox, live updates, friends
  hooks/useTheme.ts     light/dark, follows the system until you choose
  lib/doc.ts            note-document helpers (text↔checklist, search text)
  lib/collab.ts         editing a shared note together: Yjs document + Realtime channel
  lib/viewport.ts       keeps the editor above a phone's keyboard
  lib/outbox.ts         writes kept on the device and sent in order, retried while offline
  lib/offline.ts        IndexedDB copy of notes/labels and outbox; last signed-in user
  lib/hashtags.ts       "#tag" while writing → label
  components/
    Home.tsx            top bar, collage, editor orchestration
    NoteCard.tsx        a note on the desk
    PinnedTabs.tsx      pinned tabs above the collage: Mine / Shared
    TabTools.tsx        new tab / page form, Arrange (rename, reorder, delete)
    NoteRenderer.tsx    renders note JSON safely (no innerHTML)
    NoteEditor.tsx      TipTap editor sheet with a note's pages, one editing session per page (lazy-loaded)
    LabelPicker.tsx     find/create/toggle labels in a note
    SharePicker.tsx     share a note with friends, or leave one shared with you
    FriendsDialog.tsx   friend requests, names, removing friends
    Sidebar.tsx         label filter + label management + friends + sign out
  styles.css            the drafting grid, tracing paper and hand lettering
supabase/schema.sql
```
