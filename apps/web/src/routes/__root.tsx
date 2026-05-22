import { createRootRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useAuth } from "react-oidc-context";
import {
  ActionIcon,
  AppShell,
  Badge,
  Burger,
  Group,
  Menu,
  NavLink,
  Stack,
  Text,
  Title,
  Tooltip,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";

type NavItem = {
  to: string;
  label: string;
  end?: boolean;
  legacy?: boolean;
};

const NAV: NavItem[] = [
  { to: "/",             label: "Home",          end: true },
  { to: "/signals",      label: "Signals" },
  { to: "/receivers",    label: "Receivers" },
  { to: "/transmitters", label: "Transmitters" },
  { to: "/antennas",     label: "Antennas",      legacy: true },
];

function ColorSchemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const next = colorScheme === "dark" ? "light" : colorScheme === "light" ? "auto" : "dark";
  const label = `Theme: ${colorScheme} (click for ${next})`;
  const icon = colorScheme === "dark" ? "◐" : colorScheme === "light" ? "○" : "◑";
  return (
    <Tooltip label={label} withArrow>
      <ActionIcon variant="subtle" size="lg" onClick={() => setColorScheme(next)} aria-label={label}>
        <Text size="lg" lh={1}>{icon}</Text>
      </ActionIcon>
    </Tooltip>
  );
}

function UserMenu() {
  const auth = useAuth();
  const name =
    auth.user?.profile?.name ||
    auth.user?.profile?.preferred_username ||
    auth.user?.profile?.email ||
    "user";
  const email = auth.user?.profile?.email;

  return (
    <Menu position="bottom-end" withArrow>
      <Menu.Target>
        <ActionIcon variant="subtle" size="lg" aria-label="User menu">
          <Text fw={600}>{name.slice(0, 1).toUpperCase()}</Text>
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>
          <Stack gap={0}>
            <Text size="sm" fw={600}>{name}</Text>
            {email && <Text size="xs" c="dimmed">{email}</Text>}
          </Stack>
        </Menu.Label>
        <Menu.Divider />
        <Menu.Item onClick={() => void auth.signoutRedirect()}>Sign out</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

export const Route = createRootRoute({
  component: function RootLayout() {
    const [opened, { toggle }] = useDisclosure();
    const path = useRouterState({ select: (s) => s.location.pathname });

    return (
      <AppShell
        header={{ height: 56 }}
        navbar={{
          width: 220,
          breakpoint: "sm",
          collapsed: { mobile: !opened },
        }}
        padding="md"
      >
        <AppShell.Header>
          <Group h="100%" px="md" justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
              <Title order={4} m={0}>LMR Database</Title>
            </Group>
            <Group gap="xs" wrap="nowrap">
              <ColorSchemeToggle />
              <UserMenu />
            </Group>
          </Group>
        </AppShell.Header>

        <AppShell.Navbar p="xs">
          <Stack gap={2}>
            {NAV.map((item) => {
              const active = item.end
                ? path === item.to
                : path === item.to || path.startsWith(`${item.to}/`);
              return (
                <NavLink
                  key={item.to}
                  component={Link}
                  to={item.to}
                  label={item.label}
                  active={active}
                  rightSection={
                    item.legacy ? (
                      <Badge size="xs" variant="light" color="gray">legacy</Badge>
                    ) : undefined
                  }
                  onClick={() => opened && toggle()}
                />
              );
            })}
          </Stack>
        </AppShell.Navbar>

        <AppShell.Main>
          <Outlet />
        </AppShell.Main>
      </AppShell>
    );
  },
});
