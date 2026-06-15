import { Routes, Route } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { DevUpdateModal } from './components/DevUpdateModal';
import { InstallPrompt } from './components/InstallPrompt';
import { Dashboard } from './pages/Dashboard';
import { Archive } from './pages/Archive';
import { Details } from './pages/Details';
import { Stats } from './pages/Stats';
import { News } from './pages/News';
import { About } from './pages/About';
import './App.css';

function App() {
  return (
    <div className="app-container">
      <DevUpdateModal />
      <InstallPrompt />
      <Navbar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/archive" element={<Archive />} />
          <Route path="/details/:id" element={<Details />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/news" element={<News />} />
          <Route path="/about" element={<About />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
