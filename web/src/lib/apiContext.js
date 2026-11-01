// Pages read data through this context, so demo mode can swap the real API for
// the in-browser sample data without the pages knowing.
import { createContext, useContext } from 'react';
import { api } from '../api';

export const ApiContext = createContext({ api, demo: false });
export const useApi = () => useContext(ApiContext);
