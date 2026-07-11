import '@/app/globals.css';

export const metadata = {
  title: 'The Lab Operation System — School Operations, Live',
  description: 'Live school operations: schedule sync, conflict detection, workload analytics, trial intake, and instructor training.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
