'use client';

// A wrapper rather than a prop passed from AppShell: AppShell picks a component
// and renders it, so binding the category here keeps the component identity
// stable across renders instead of remounting the table on every navigation.
import LiveProgressTable from './LiveProgressTable';

export default function NewKinderProgressPage() {
  return <LiveProgressTable category="Kinder" />;
}
