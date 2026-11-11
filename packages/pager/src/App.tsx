/**
 * Screen router of the pager. Five screens, one state: the device, the memory,
 * the settings, the pairing and the demonstration (A.11).
 */
import { DemoPanel } from './components/DemoPanel.js';
import { MemoryList } from './components/MemoryList.js';
import { PagerScreen } from './components/PagerScreen.js';
import { PairingPanel } from './components/PairingPanel.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { StatusBar } from './components/StatusBar.js';
import { PagerProvider, usePager, type PagerProviderProps } from './state/PagerContext.js';

export type AppProps = Omit<PagerProviderProps, 'children'>;

export function App(props: AppProps): React.JSX.Element {
  return (
    <PagerProvider {...props}>
      <Shell />
    </PagerProvider>
  );
}

function Shell(): React.JSX.Element {
  const { state } = usePager();
  return (
    <div className="app">
      <StatusBar />
      <main className="screen">
        {state.screen === 'pager' && <PagerScreen />}
        {state.screen === 'memory' && <MemoryList />}
        {state.screen === 'settings' && <SettingsPanel />}
        {state.screen === 'pairing' && <PairingPanel />}
        {state.screen === 'demo' && <DemoPanel />}
      </main>
    </div>
  );
}
