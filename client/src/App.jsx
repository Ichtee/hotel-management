import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./context/Auth";
import Application from "./routes/Application";
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <Application />
      </AuthProvider>
    </BrowserRouter>
  );
}
