import { createRoot } from 'react-dom/client';
import CssBaseline from '@mui/material/CssBaseline';
import { Spike } from './Spike';
import 'ol/ol.css';
import './spike.css';

createRoot(document.getElementById('root')!).render(<><CssBaseline /><Spike /></>);
