import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5.2c.1 4.6 0 9.1-.1 13.6M5.2 12.1c4.5-.2 9.1-.2 13.6 0" />
  </Svg>
)

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.6 4.4c3.6-.2 6.3 2.5 6.2 5.9-.1 3.5-2.8 6.1-6.2 6.1-3.5 0-6.2-2.7-6.1-6.1.1-3.3 2.7-5.8 6.1-5.9z" />
    <path d="M15.2 15.1l4.6 4.5" />
  </Svg>
)

export const SunIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 8.1c2.2 0 3.9 1.7 3.9 3.9 0 2.2-1.8 3.9-3.9 3.9-2.2 0-3.9-1.7-3.9-3.9 0-2.1 1.7-3.9 3.9-3.9z" />
    <path d="M12 2.8v1.9M12 19.3v1.9M4.9 4.9l1.3 1.3M17.8 17.8l1.3 1.3M2.8 12h1.9M19.3 12h1.9M4.9 19.1l1.3-1.3M17.8 6.2l1.3-1.3" />
  </Svg>
)

export const MoonIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19.6 14.6c-1 .4-2.1.6-3.2.6-4.4 0-7.8-3.4-7.8-7.7 0-1.2.3-2.3.7-3.3C6 5.4 3.8 8.5 3.9 12.1c.1 4.5 3.7 8 8.2 8 3.4 0 6.3-2.2 7.5-5.5z" />
  </Svg>
)

export const MenuIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7.1c5.4-.3 10.7-.2 16 0M4 12.1c5.3-.2 10.6-.1 16 .1M4 17.1c3.6-.2 7.3-.2 11 0" />
  </Svg>
)

export const TagIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.9 12.6l.1-7.7c0-.6.4-1 1-1l7.6.1c.3 0 .5.1.7.3l7 7c.4.4.4 1 0 1.4l-7.4 7.4c-.4.4-1 .4-1.4 0l-7.3-6.8c-.2-.2-.3-.4-.3-.7z" />
    <path d="M8.3 7.4c.6 0 1 .4 1 1s-.5 1-1 1-1-.4-1-1 .4-1 1-1z" />
  </Svg>
)

export const NotesIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.1 3.6c4-.3 8-.3 12 .1.4 5.5.4 11 0 16.6-4 .3-8 .3-12 0-.4-5.6-.4-11.1 0-16.7z" />
    <path d="M9 9c2-.1 4.1-.1 6.1 0M9 12.6c1.8-.1 3.6-.1 5.3 0M9 16.1c1.1-.1 2.2-.1 3.3 0" />
  </Svg>
)

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 6.6c5-.3 10-.3 15 0M9.4 6.4c0-1.3.5-2.4 2.6-2.4 2.1 0 2.6 1.1 2.6 2.4" />
    <path d="M6.3 6.8l.9 12.4c.1.7.6 1.1 1.2 1.1h7.2c.6 0 1.1-.4 1.2-1.1l.9-12.4M10.2 10.4l.2 6.3M13.8 10.4l-.2 6.3" />
  </Svg>
)

export const ChecklistIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.1 5.1c1.5-.1 3-.1 4.5 0 .1 1.5.1 3 0 4.5-1.5.1-3 .1-4.5 0-.1-1.5-.1-3 0-4.5z" />
    <path d="M5.2 7.4l1.1 1.1 2.9-3.4" />
    <path d="M4.1 14.4c1.5-.1 3-.1 4.5 0 .1 1.5.1 3 0 4.5-1.5.1-3 .1-4.5 0-.1-1.5-.1-3 0-4.5z" />
    <path d="M12 7.4c2.6-.1 5.3-.1 8 0M12 16.7c2.6-.1 5.3-.1 8 0" />
  </Svg>
)

export const TextIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6.4c5.4-.2 10.7-.2 16 0M4 10.5c5.3-.1 10.6-.1 16 0M4 14.6c5.3-.1 10.6-.1 16 0M4 18.6c3.3-.1 6.6-.1 10 0" />
  </Svg>
)

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6.2c4 3.8 8 7.7 12 11.7M18 6.1c-4.1 3.9-8 7.8-11.9 11.8" />
  </Svg>
)

export const PencilIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15.6 4.6c.8-.8 2-.8 2.8 0l1 1c.8.8.8 2 0 2.8L9 18.8l-4.6 1 1-4.6L15.6 4.6z" />
    <path d="M13.8 6.5l3.8 3.8" />
  </Svg>
)

export const LeaveIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.2 4.1c-2.6-.1-5.2-.1-7.8 0-.7 0-1.3.6-1.3 1.3-.1 4.4-.1 8.8 0 13.2 0 .7.6 1.3 1.3 1.3 2.6.1 5.2.1 7.8 0" />
    <path d="M10.4 12.1c3.3-.1 6.6-.1 9.9 0M16.9 8.6l3.5 3.5-3.5 3.4" />
  </Svg>
)

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.9c1.4 1.3 2.7 2.7 4 4.2 3-4.1 6.3-7.8 10-11.1" />
  </Svg>
)

export const PeopleIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.2 4.6c1.9 0 3.3 1.5 3.3 3.3 0 1.9-1.5 3.4-3.3 3.4-1.9 0-3.3-1.5-3.3-3.4 0-1.8 1.4-3.3 3.3-3.3z" />
    <path d="M3.4 19.2c.2-3.2 2.6-5.4 5.8-5.4 3.1 0 5.6 2.2 5.8 5.4" />
    <path d="M15.6 5c1.6.3 2.7 1.6 2.7 3.1 0 1.6-1.1 2.9-2.7 3.2M17.4 14.2c2 .6 3.3 2.4 3.3 4.9" />
  </Svg>
)

export const HomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.2 10.6c2.6-2.3 5.2-4.5 7.8-6.6 2.6 2.1 5.2 4.3 7.8 6.6" />
    <path d="M6.1 9.2c-.1 3.6-.1 7.2 0 10.8 4 .2 7.9.2 11.8 0 .1-3.6.1-7.2 0-10.8" />
    <path d="M10 20c-.1-1.9-.1-3.7 0-5.6 1.4-.1 2.7-.1 4 0 .1 1.9.1 3.7 0 5.6" />
  </Svg>
)

export const BriefcaseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.9 8.1c5.4-.3 10.8-.3 16.2 0 .3 3.8.3 7.6 0 11.4-5.4.3-10.8.3-16.2 0-.3-3.8-.3-7.6 0-11.4z" />
    <path d="M8.9 8c0-1.2-.1-2.3.1-3.4 2-.2 4-.2 6 0 .2 1.1.1 2.2.1 3.4" />
    <path d="M4 12.9c5.3 1.4 10.7 1.4 16 0" />
  </Svg>
)
