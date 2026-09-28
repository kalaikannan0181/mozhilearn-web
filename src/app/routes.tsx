import { createBrowserRouter, Navigate } from "react-router";
import { ProtectedRoute } from "../features/auth/ProtectedRoute";
import { DashboardPage } from "../pages/DashboardPage";
import { LoginPage } from "../pages/LoginPage";
import { LessonDetailPage } from "../pages/LessonDetailPage";
import { LessonsPage } from "../pages/LessonsPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { PlannedPage } from "../pages/PlannedPage";
import { ReviewerPage } from "../pages/ReviewerPage";
import { PacksPage } from "../pages/PacksPage";
import { LibraryPage } from "../pages/LibraryPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/login" replace />,
  },
  {
    path: "/login",
    Component: LoginPage,
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: "/dashboard",
        Component: DashboardPage,
      },
      {
        path: "/lessons",
        Component: LessonsPage,
      },
      {
        path: "/lessons/:id",
        Component: LessonDetailPage,
      },
      {
        path: "/review",
        Component: ReviewerPage,
      },
      {
        path: "/packs",
        Component: PacksPage,
      },
      {
        path: "/library",
        Component: LibraryPage,
      },
      {
        path: "/create-lesson",
        Component: PlannedPage,
      },
    ],
  },
  {
    path: "*",
    Component: NotFoundPage,
  },
]);
