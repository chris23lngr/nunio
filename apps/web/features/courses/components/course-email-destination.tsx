import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EmailDestination } from "@/features/study/components/email-destination";
import { confirmedText } from "@/features/study/study-format";
import { createApiClient } from "@/lib/api-client";
import { coursePageQuery } from "../api/course-queries";

/** The Course's default email Destination, which its Obligations use unless they have their own. */
export function CourseEmailDestination({
  apiOrigin,
  courseId,
  destination,
}: {
  apiOrigin: string;
  courseId: string;
  destination: { address: string; confirmedAt: string } | null;
}) {
  const queryClient = useQueryClient();
  const confirm = useMutation({
    mutationFn: async (address: string | null) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/courses/{id}/email-destination",
        { params: { path: { id: courseId } }, body: { address } },
      );
      if (result.response.status === 400)
        throw new Error("Das ist keine gültige E-Mail-Adresse.");
      if (!result.data) throw new Error("Das konnte nicht gespeichert werden.");
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: coursePageQuery(apiOrigin, courseId).queryKey,
      }),
  });
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-base-500">
        Gilt für jede Abgabe dieses Kurses ohne eigene Adresse.
      </p>
      <EmailDestination
        confirmed={
          destination && {
            address: destination.address,
            note: confirmedText(destination.confirmedAt),
          }
        }
        prefill={null}
        pending={confirm.isPending}
        error={confirm.error?.message ?? null}
        onConfirm={(address) => confirm.mutateAsync(address)}
        onClear={() => confirm.mutate(null)}
      />
    </div>
  );
}
