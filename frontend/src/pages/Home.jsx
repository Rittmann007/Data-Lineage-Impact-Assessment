import { useState } from "react";
import backgroundImage from "../assets/homepage-bg-2.avif";

const features = [
  {
    id: 1,
    title: "Discover & Understand",
    short: "Make scattered data easier to find and understand.",
    description:
      "Get a clear view of your organization's data assets along with important metadata such as ownership, criticality, sensitivity, lifecycle, and modernization status.",
  },
  {
    id: 2,
    title: "Trace Dependencies",
    short: "See how data moves across your ecosystem.",
    description:
      "Understand the relationships between files, pipelines, tables, and reports so that hidden upstream and downstream dependencies become easier to identify.",
  },
  {
    id: 3,
    title: "Assess Change Impact",
    short: "Understand what could be affected before making a change.",
    description:
      "Analyze downstream dependencies to identify affected assets, their owners, criticality, and the number of relationship hops between them.",
  },
  {
    id: 4,
    title: "Plan Modernization",
    short: "Turn data visibility into better modernization decisions.",
    description:
      "Use lifecycle and modernization metadata to understand which assets can be retained, remediated, migrated, redesigned, or retired.",
  },
];

function Home() {
  const [expandedCard, setExpandedCard] = useState(null);

  const handleCardClick = (id) => {
    setExpandedCard((current) => (current === id ? null : id));
  };

  return (
    <div
      className="min-h-screen bg-cover bg-center bg-fixed text-white"
      style={{ backgroundImage: `url(${backgroundImage})` }}
    >
      {/* Dark overlay for readability */}
      <div className="min-h-screen bg-black/35">

        {/* Hero Section */}
        <section className="mx-auto flex min-h-[72vh] max-w-7xl flex-col items-center justify-center px-6 text-center">
          <p className="mb-5 text-sm font-semibold uppercase tracking-[0.35em] text-blue-200">
            Data Estate Intelligence
          </p>

          <h1 className="max-w-5xl text-5xl font-bold leading-tight md:text-7xl">
            Understand Your{" "}
            <span className="text-blue-300">Data Estate</span>
          </h1>

          <p className="mt-7 max-w-3xl text-lg leading-8 text-gray-200 md:text-xl">
            Discover data assets, trace relationships, and understand the
            potential impact of changes across your organization's connected
            data ecosystem.
          </p>
        </section>

        {/* Features Section */}
        <section className="mx-auto max-w-7xl px-6 pb-28">
          <div className="mb-10 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-blue-200">
              What We Provide
            </p>

            <h2 className="mt-3 text-3xl font-bold md:text-4xl">
              Turn Data Complexity Into Clarity
            </h2>
          </div>

          <div className="flex min-h-[330px] flex-col gap-4 md:flex-row">
            {features.map((feature) => {
              const isExpanded = expandedCard === feature.id;

              return (
                <div
                  key={feature.id}
                  onClick={() => handleCardClick(feature.id)}
                  className={`
                    relative cursor-pointer overflow-hidden rounded-2xl
                    border transition-all duration-500 ease-in-out
                    before:pointer-events-none before:absolute before:inset-0
                    before:bg-gradient-to-br before:from-white/15 before:via-transparent before:to-transparent
                    before:opacity-70
                    after:pointer-events-none after:absolute after:-right-10 after:-top-10
                    after:h-32 after:w-32 after:rounded-full
                    after:bg-white/10 after:blur-3xl
                    ${
                      isExpanded
                        ? "flex-[2.2] border-red-100/50 bg-red-400/10 backdrop-blur-md shadow-2xl shadow-red-500/20 ring-1 ring-inset ring-white/15"
                        : "flex-1 border-blue-100/50 bg-blue-400/10 backdrop-blur-md shadow-2xl shadow-blue-500/20 ring-1 ring-inset ring-white/15"
                    }
                  `}
                >
                  <div className="relative z-10 flex h-full flex-col p-6 md:p-7">
                    <div>
                      <span className="text-sm font-semibold tracking-widest text-white/60">
                        0{feature.id}
                      </span>

                      <h3 className="mt-4 text-2xl font-bold leading-tight">
                        {feature.title}
                      </h3>

                      <p
                        className={`mt-4 leading-7 text-white/85 ${
                          isExpanded ? "max-w-xl" : "line-clamp-3"
                        }`}
                      >
                        {isExpanded ? feature.description : feature.short}
                      </p>
                    </div>

                    {/* Plus / Minus button */}
                    <div className="mt-auto flex justify-end pt-8">
                      <div
                        className={`
                          flex h-10 w-10 items-center justify-center
                          rounded-full border border-white/60
                          text-2xl font-light transition-transform duration-300
                          ${isExpanded ? "rotate-180" : ""}
                        `}
                      >
                        {isExpanded ? "−" : "+"}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* How It Works */}
        <section className="mx-auto max-w-7xl px-6 pb-32">
          <div className="mb-16 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-blue-200">
              The Process
            </p>

            <h2 className="mt-3 text-3xl font-bold md:text-4xl">
              How It Works
            </h2>
          </div>

          <div className="relative">
            {/* Horizontal pipeline */}
            <div className="absolute left-[12%] right-[12%] top-7 hidden h-0.5 bg-white/30 md:block" />

            <div className="grid gap-12 md:grid-cols-4 md:gap-6">
              <div className="relative text-center">
                <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-700 font-bold">
                  01
                </div>

                <h3 className="mt-6 text-xl font-bold">Discover</h3>

                <p className="mt-3 leading-7 text-gray-300">
                  Identify data assets and capture their important metadata.
                </p>
              </div>

              <div className="relative text-center">
                <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-700 font-bold">
                  02
                </div>

                <h3 className="mt-6 text-xl font-bold">Map</h3>

                <p className="mt-3 leading-7 text-gray-300">
                  Connect assets through their relationships and lineage.
                </p>
              </div>

              <div className="relative text-center">
                <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-700 font-bold">
                  03
                </div>

                <h3 className="mt-6 text-xl font-bold">Analyze</h3>

                <p className="mt-3 leading-7 text-gray-300">
                  Trace dependencies and understand the potential impact of
                  changes.
                </p>
              </div>

              <div className="relative text-center">
                <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-700 font-bold">
                  04
                </div>

                <h3 className="mt-6 text-xl font-bold">Act</h3>

                <p className="mt-3 leading-7 text-gray-300">
                  Use the resulting insights to make informed data-management
                  decisions.
                </p>
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}

export default Home;