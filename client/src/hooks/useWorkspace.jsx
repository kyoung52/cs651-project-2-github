import { createContext, useContext, useMemo, useState } from 'react';

const WorkspaceContext = createContext({
  dashboardState: null,
  setDashboardState: () => {},
  resetDashboardState: () => {},
  exploreState: null,
  setExploreState: () => {},
  resetExploreState: () => {},
});

export function WorkspaceProvider({ children }) {
  const [dashboardState, setDashboardState] = useState(null);
  const [exploreState, setExploreState] = useState(null);

  const value = useMemo(
    () => ({
      dashboardState,
      setDashboardState,
      resetDashboardState: () => setDashboardState(null),
      exploreState,
      setExploreState,
      resetExploreState: () => setExploreState(null),
    }),
    [dashboardState, exploreState]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}

