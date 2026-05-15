import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import type { SkillDto, CreateSkillParams, UpdateSkillParams, DeleteSkillParams } from "@/ipc/types/skills";

export type { SkillDto };

export function useSkills(appId?: number) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.skills.list(appId),
    queryFn: (): Promise<SkillDto[]> => ipc.skill.list({ appId }),
    meta: { showErrorToast: true },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.skills.all() });

  const createMutation = useMutation({
    mutationFn: (params: CreateSkillParams) => ipc.skill.create(params),
    onSuccess: invalidate,
    meta: { showErrorToast: true },
  });

  const updateMutation = useMutation({
    mutationFn: (params: UpdateSkillParams) => ipc.skill.update(params),
    onSuccess: invalidate,
    meta: { showErrorToast: true },
  });

  const deleteMutation = useMutation({
    mutationFn: (params: DeleteSkillParams) => ipc.skill.delete(params),
    onSuccess: invalidate,
    meta: { showErrorToast: true },
  });

  return {
    skills: query.data ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
    invalidate,
    createSkill: createMutation.mutateAsync,
    updateSkill: updateMutation.mutateAsync,
    deleteSkill: deleteMutation.mutateAsync,
  };
}
