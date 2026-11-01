import { useEffect, useState } from 'react';
import Admin from './Admin.jsx';
import Customer from './Customer.jsx';
import { AuthProvider } from './context/Auth.jsx';

export default function App() {
  const [route, setRoute] = useState(location.hash || '#/');
  useEffect(() => {
    const on = () => { setRoute(location.hash || '#/'); scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return <AuthProvider>{route.startsWith('#/admin') ? <Admin route={route} /> : <Customer route={route} />}</AuthProvider>;
}
