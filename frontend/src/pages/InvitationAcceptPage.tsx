import { Alert, Button, Container, Stack, Typography } from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { projectAPI } from "../api/api";
import { useAuth } from "../auth/useAuth";
import { useTranslation } from "../i18n";
import {
  buildInvitationAcceptPath,
  clearInvitationRedirectStorage,
  getStoredInvitationToken,
  storeInvitationRedirect,
} from "./invitationAcceptance";

type AcceptStatus = "loading" | "redirecting" | "success" | "error";

const acceptedInvitationTokens = new Set<string>();

export default function InvitationAcceptPage() {
  const { t } = useTranslation("projectInvitations");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isLoading, switchActiveProject, refreshUser, logout } = useAuth();
  const [status, setStatus] = useState<AcceptStatus>("loading");
  const [message, setMessage] = useState<string>("");
  const [emailMismatch, setEmailMismatch] = useState<boolean>(false);
  const processedTokenRef = useRef<string | null>(null);
  const terminalSuccessRef = useRef<boolean>(false);

  const token = useMemo(() => {
    const tokenFromQuery = searchParams.get("token");
    return tokenFromQuery?.trim() || getStoredInvitationToken();
  }, [searchParams]);

  useEffect(() => {
    console.info("[InvitationAcceptPage] route reached", {
      path: window.location.pathname,
      search: window.location.search,
    });

    if (!token) {
      queueMicrotask(() => {
        setStatus("error");
        setMessage(t("result.invalid_token"));
      });
      return;
    }

    console.info("[InvitationAcceptPage] parsed token", { token });
    const nextPath = buildInvitationAcceptPath(token);
    storeInvitationRedirect(nextPath, token);

    if (acceptedInvitationTokens.has(token)) {
      terminalSuccessRef.current = true;
      queueMicrotask(() => {
        setStatus("success");
        setMessage(t("acceptPage.addedToProject"));
      });
      return;
    }

    if (isLoading) {
      queueMicrotask(() => {
        setStatus("loading");
        setMessage(t("acceptPage.accepting"));
      });
      return;
    }

    const acceptInvitation = async (): Promise<void> => {
      if (processedTokenRef.current === token) {
        return;
      }
      processedTokenRef.current = token;
      setStatus("loading");
      setEmailMismatch(false);
      setMessage(t("acceptPage.accepting"));

      try {
        console.info("[InvitationAcceptPage] calling accept API", { token });
        const response = await projectAPI.acceptInvitationByToken(token);
        const projectId = response.data.project?.id ?? response.data.project_id;
        if (projectId) {
          window.localStorage.setItem("activeProjectId", String(projectId));
          await switchActiveProject(projectId);
          await refreshUser();
        }
        clearInvitationRedirectStorage();
        acceptedInvitationTokens.add(token);
        terminalSuccessRef.current = true;
        console.info(
          "[InvitationAcceptPage] invitation accepted successfully",
          { projectId },
        );
        setStatus("success");
        setMessage(t("acceptPage.addedToProject"));
        window.setTimeout(
          () => navigate("/app/fields-beds", { replace: true }),
          1200,
        );
      } catch (acceptError: unknown) {
        if (terminalSuccessRef.current || acceptedInvitationTokens.has(token)) {
          return;
        }
        console.error(
          "[InvitationAcceptPage] invitation acceptance failed",
          acceptError,
        );
        const errorData = (
          acceptError as {
            response?: { data?: { code?: string; email_masked?: string } };
          }
        )?.response?.data;
        const code = errorData?.code ?? "invalid_token";
        if (code === "email_mismatch") {
          clearInvitationRedirectStorage();
          setStatus("error");
          setEmailMismatch(true);
          setMessage(
            t("result.email_mismatch", {
              invitedEmail: errorData?.email_masked ?? "",
              currentEmail: user?.email ?? "",
            }),
          );
          return;
        }

        if (code === "already_member") {
          clearInvitationRedirectStorage();
          console.info("[InvitationAcceptPage] invitation already satisfied", {
            code,
          });
          setStatus("success");
          setMessage(t(`result.${code}`));
          window.setTimeout(
            () => navigate("/app/fields-beds", { replace: true }),
            1200,
          );
          return;
        }

        if (
          code === "invalid_token" ||
          code === "expired" ||
          code === "revoked" ||
          code === "accepted"
        ) {
          clearInvitationRedirectStorage();
        }

        setStatus("error");
        setMessage(
          t(`result.${code}`, { defaultValue: t("result.invalid_token") }),
        );
      }
    };

    const continueAnonymousFlow = async (): Promise<void> => {
      if (user) {
        void acceptInvitation();
        return;
      }

      try {
        const statusResponse = await projectAPI.getInvitationStatus(token);
        if (terminalSuccessRef.current || acceptedInvitationTokens.has(token)) {
          return;
        }
        if (statusResponse.data.code !== "pending") {
          clearInvitationRedirectStorage();
          setStatus("error");
          setMessage(
            t(`result.${statusResponse.data.code}`, {
              defaultValue: t("result.invalid_token"),
            }),
          );
          return;
        }
      } catch (statusError: unknown) {
        if (terminalSuccessRef.current || acceptedInvitationTokens.has(token)) {
          return;
        }
        const code =
          (statusError as { response?: { data?: { code?: string } } })?.response
            ?.data?.code ?? "invalid_token";
        clearInvitationRedirectStorage();
        setStatus("error");
        setMessage(t(`result.${code}`, { defaultValue: t("result.invalid_token") }));
        return;
      }

      setStatus("redirecting");
      console.info(
        "[InvitationAcceptPage] user not authenticated, redirecting to login",
        { nextPath },
      );
      navigate(`/login?next=${encodeURIComponent(nextPath)}`, {
        replace: true,
      });
    };

    void continueAnonymousFlow();
  }, [isLoading, navigate, refreshUser, switchActiveProject, t, token, user]);

  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Stack spacing={2}>
        <Typography variant="h4">{t("acceptPage.title")}</Typography>
        {status === "loading" || status === "redirecting" ? (
          <Alert severity="info">
            {status === "redirecting"
              ? t("acceptPage.redirectingToLogin")
              : message || t("acceptPage.accepting")}
          </Alert>
        ) : null}
        {status === "success" ? (
          <Alert severity="success">{message}</Alert>
        ) : null}
        {status === "error" ? <Alert severity="error">{message}</Alert> : null}
        {emailMismatch ? (
          <Button
            variant="outlined"
            onClick={() => {
              void (async () => {
                await logout();
                navigate(
                  `/login?next=${encodeURIComponent(buildInvitationAcceptPath(token ?? ""))}`,
                  { replace: true },
                );
              })();
            }}
          >
            {t("loginWithDifferentAccount")}
          </Button>
        ) : null}
        <Button
          variant="outlined"
          onClick={() => navigate("/app/fields-beds", { replace: true })}
        >
          {t("openApp")}
        </Button>
      </Stack>
    </Container>
  );
}
