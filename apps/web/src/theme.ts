// Mantine theme for the LMR database.
//
// Goals: dark-by-default-feels-natural, slightly tighter spacing than
// stock Mantine (data tools are dense), default font stack (system).

import { createTheme } from "@mantine/core";

export const theme = createTheme({
  primaryColor: "blue",
  defaultRadius: "sm",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
  headings: {
    fontWeight: "600",
  },
  components: {
    Table: {
      defaultProps: {
        striped: true,
        highlightOnHover: true,
        withTableBorder: true,
        withColumnBorders: false,
        verticalSpacing: "xs",
      },
    },
    Button: {
      defaultProps: {
        radius: "sm",
      },
    },
  },
});
