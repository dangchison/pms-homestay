import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssignPropertyRoleRequest,
  InviteUserRequest,
  UpdatePropertyRoleRequest,
  UpdateUserRequest,
  UserPropertyRoleResponse,
  UserResponse,
} from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/** S2 — danh sách users của tenant. */
export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient.get<{ data: UserResponse[] }>('/users').then((r) => r.data),
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: InviteUserRequest) =>
      apiClient.post<{ data: UserResponse }>('/users', body).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserRequest }) =>
      apiClient.patch<{ data: UserResponse }>(`/users/${id}`, body).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUserPropertyRoles(userId: string | null) {
  return useQuery({
    queryKey: ['user-property-roles', userId ?? ''],
    queryFn: () =>
      apiClient
        .get<{ data: UserPropertyRoleResponse[] }>(`/users/${userId}/property-roles`)
        .then((r) => r.data),
    enabled: !!userId,
  });
}

export function useAssignRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AssignPropertyRoleRequest) =>
      apiClient.post<{ data: UserPropertyRoleResponse }>('/user-property-roles', body).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['user-property-roles'] }),
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePropertyRoleRequest }) =>
      apiClient.patch<{ data: UserPropertyRoleResponse }>(`/user-property-roles/${id}`, body).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['user-property-roles'] }),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/user-property-roles/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['user-property-roles'] }),
  });
}
