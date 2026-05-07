import '@/app/globals.css';

export const metadata = {
  title: 'Schedule Intelligence Dashboard',
  description: 'Automated Conflict Detection & Instructor Availability',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
