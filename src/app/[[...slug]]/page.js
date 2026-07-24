// The UI (AuthProvider + AppShell) lives in the persistent segment layout so it
// isn't torn down on every navigation. The page itself renders nothing — the
// shell derives the current view from the URL pathname.
export default function CatchAllRootPage() {
  return null;
}
