import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useConnection } from '../connection';
import { Loading, Screen } from '../ui';

/** toto://demo, or /app/demo in a browser: opens the demo Toto, from a link. */
export default function DemoLink() {
  const { addDemo } = useConnection();
  const router = useRouter();
  useEffect(() => {
    addDemo();
    router.replace('/');
    // Once, on arriving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Screen bare>
      <Loading>Opening the demo…</Loading>
    </Screen>
  );
}
