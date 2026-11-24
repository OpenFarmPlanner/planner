import { useMemo } from "react";
import { useAuth } from "../auth/useAuth";
import type { ProjectMembershipInfo } from "../auth/types";

export type MissingProjectReason = "no_projects" | "no_active_project";

export interface ProjectRequirementState {
  isAuthLoading: boolean;
  userId: number | null;
  hasAnyProjects: boolean;
  hasActiveProject: boolean;
  /** The active project's id, or null without one. */
  activeProjectId: number | null;
  activeProjectMembership?: ProjectMembershipInfo;
  shouldShowProjectRequiredState: boolean;
  missingProjectReason: MissingProjectReason | null;
}

export function useProjectRequirement(): ProjectRequirementState {
  const { user, isLoading, activeProjectId } = useAuth();

  return useMemo(() => {
    const memberships = user?.memberships ?? [];
    const hasAnyProjects = memberships.length > 0;
    const hasActiveProject = typeof activeProjectId === "number" && activeProjectId > 0;
    const shouldShowProjectRequiredState = !isLoading && !hasActiveProject;
    const missingProjectReason: MissingProjectReason | null = shouldShowProjectRequiredState
      ? (hasAnyProjects ? "no_active_project" : "no_projects")
      : null;

    return {
      isAuthLoading: isLoading,
      userId: user?.id ?? null,
      hasAnyProjects,
      hasActiveProject,
      activeProjectId: hasActiveProject ? activeProjectId : null,
      activeProjectMembership: memberships.find(membership => membership.project_id === activeProjectId),
      shouldShowProjectRequiredState,
      missingProjectReason,
    };
  }, [activeProjectId, isLoading, user?.id, user?.memberships]);
}
