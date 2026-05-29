RAW_PROMPTS

#Techstack

| Component            | Technology                        | Version/Notes                          |
| -------------------- | --------------------------------- | -------------------------------------- |
| **Languages**        | TypeScript + Bun                  | TS v5.7, Bun latest                    |
|                      | Python                            | **v3.12+** (embedded for AI agents)    |
| **CLI Framework**    | Ink + React                       | Terminal UI components                 |
|                      | Commander.js                      | Command routing                        |
| **Layout Engine**    | Yoga                              | Terminal layout                        |
| **TUI Visuals**      | Ink + Figlet + terminal-image     | ASCII + inline images                  |
| **API/Backend**      | **Embedded in CLI**               | **NO separate backend** (Axum removed) |
| **ORM**              | Drizzle ORM                       | For cloud sync only (optional)         |
| **Database (Local)** | **Bun SQLite**                    | Embedded, zero-config                  |
| **Database (Cloud)** | Turso or Supabase                 | Optional sync                          |
| **Agent Framework**  | **LangGraph  Python + FastAPI **  | v0.2+                                  |
|                      | **Vercel AI SDK**                 | v4 (primary AI interface)              |
| **State Management** | TanStack Query + Zustand          | Query v5.90+, Zustand v5.0+            |
| **Payment**          | **Polar**                         | Choose one                             |
| **Auth**             | Clerk                             | Pro users only                         |
| **Web Scraping**     | Firecrawl                         | v2.5 (Docker or API)                   |
| **RAG/Vector DB**    | Chroma/LanceDB Registry-based RAG | Local and also internet seacrhing      |
| **MCP Servers**      | MCP + vercel's agent browser      | v1.0                                   |
| **Design Tool**      | Penpot                            | v2.11.1 (local Docker)                 |
| **Image Processing** | Sharp (primary)                   | Node.js native                         |
|                      | imgproxy                          | Docker (optional)                      |
| **Storage**          | Local filesystem (default)        | Zero config                            |
|                      | MinIO                             | Self-hosted S3 (optional)              |
|                      | cloudinary                        | Cloud backup (optional)                |
| **AI Models**        | OpenRouter                        | Direct SDK or via Vercel AI SDK        |
| **Security Tools**   | All via Docker                    | Semgrep, ZAP, etc.                     |
| **Deployment**       | npm registry                      | `npm install -g pakalon`               |
| **Cloud Services**   | Vercel                            | Marketing + telemetry API only         |
|                      | Supabase                          | Auth/telemetry DB (free tier)          |
| **Memory**           | Mem0                              | Via Docker                             |
| **Web scrapping**    | Firecrawl                         | To search across internet, scrape data |
| **Email services**   | Resend                            | To notify users about plan & billing   |


**Working**

Phase 1: Planning & Requirements
In this phase you will get the input from the user about what is he building and what are the features and requirements that the application must have and also there should be like a conversation with the user to get the complete details - you will ask more question and get a clarity about the project and then if the user satisfied and then happy with the planning process and if the user is not satisfied then the process continues in loop , the more question will be asked like about tech - the frontend , backend methodologies that is be to used and then get a clear idea and if the user satisfied and approves the planning the next phase starts.
There should be a brainstorming session and question and answering session between the user and the AI agents and also the AI agents should ask many more and more questions regarding the tech stack and the methods that are about to be implemented, 
The interaction between the user and the AI agents should take place in the preview section of the workspace after the user gives the 1st input like building some software application, if the user is in the human in loop mode : 
The interaction between the user and the AI agents should take place like after the 1st input the AI agent in the phase should be able to get idea what the user is trying to build and the brain storming session and the Q/A session should take place in the form of multiple choices like the AI agent will give the tech stack that are to be used like the possible tech stack that are to be used in the application that the user is building in a options, there will be some options that the AI agent will plan and give it to the user and if the user chooses any one then the AI and the AI agent takes that as the input from the user and then plans more and also there should be a another choices also like : get the input tech stack requirement from the user and also there should be an option to skip the phase 1. In detail for the frontend there will be an interaction between the user and the AI agent how the frontend should be, similarly  for all the things that the planning AI agent needs that interaction and the information should be got from the user and the AI agent should prepare some relative question and should be displayed below these choices whenever there is an interaction that is happening, and when the user clicks on to that question and the AI agents should make the question and the choices for that question as an interaction between the user and the AI agent. And for information gathering use web scrapping use Fire crawl and MCP servers and get the information and then plan accordingly. And this AI agent should contain some specific prompts as a system prompts for asking and interacting with the users.  For example if the user gives the prompt as : create a full stack application on building a SaaS application on food delivery app, This AI agent should be able to fetch the details from the internet for existing already available and then load the information that this AI agent has got from web scraping and with the help of MCP server and then saves this information in the memory of the AI agent and then uses this information to ask the question to the user in multiple choice and only any 1 is choose able not a multiple options cannot be choose like the AI agent should ask the frontend to be used in options : 
1. Option 1 - HTML, CSS, JS
2. Option 2 - Reactjsx, next,js, vite, Shadcn UI
3. Option 3 - electron, vite
4. Option 4 - The input from the user, the user;s choice
And some follow up questions below these regarding this question like : 
Do you want to implement a 3d design in the frontend
Do you want a dual theme option or mono theme option

And when the user clicks on the follow up question then the multiple choice opens ans keeping as the question and then the answer for that question when the user selects that choice then that is taken as input and then that is saved in the memory of the AI agent of the phase 1, 

Then after everything is over like after making a complete interaction section with the user then after saving all the inputs from the user the AI agent should ask a question like do you want to continue this session or end this session and if the user gives as continue then the brain storming and the Q/A session continues and if the user clicks on end then all the input that the user has given should be taken and should prepare a new document and then save that document either in .md form or in .json format  in a folder of this project in the IDE section and should be named as phase 1 for that file and the folder name should be AI agents. While preparing the document the phase 1 AI agent should be able to make a detailed workflow, working , frontend, backend technologies used, how many pages should be present and weather the application is a web based application or a standalone application that is multi OS support or for mobiles apps supports android and IOS , frameworks to be used and then the what are the elements to be present in which place in the UI and about the backend, the payments , AI integration , AI working, everything should be asked and then those information to be made into document and saved in the folder AI agents with the name as phase 1  phase-1.md. After the Phase 1 completes their work and to stop the interaction with the user then there should be an option called as stop this phase, if clicked then the document creating process starts.

If the user chooses the YOLO mode then the AI agents  itself plans everything and then works accordingly the user’s role of asking and interacting restricted in this kind of mode all the work and everything is planned and documented only by the AI itself only there is no human interaction between the AI agents 

After the AI agent made the document and saved in the AI agents folder then when the next phase AI agent when the next phase , when phase 2 starts then it should be able to start by reading and analysing the phase-1.md and then only the next phase should start.

Phase 2: Design & Architecture
When this phase is starting it should automatically call and place the phase 2 AI agent and then it should read the phase-1.md file and then should come to a clear idea before starting this phase of AI agents, this process should start automatically when this phase 2 phase is started.

Teams Involved:
UI/UX Design Team - Creates wireframes, mock-ups, and prototypes visualize the user interface and experience
Software Architecture Team - Designs the high-level system architecture, outlines component structures, modules and their interactions, and makes decisions on technology selection
Technical Leadership Team - Shapes initial ideas into technical solutions, builds the product's architectural logic, and ensures scalability, security, and performance standards
In this phase 2 , you will generate some wireframes first from the detailed that you have gained from planning and then if the user approves the design then the real UI part comes up of creating the UI design and if the user approves that then the high level architecture part comes , you will have to design the high level architecture and also work flows about the connection of the frontend, backend, calling of API and the working part , and then if the user approves that then the next phases starts 
The wireframe design should be designed in the IDE section, the user must be able to see a real wireframe design in the IDE section either by coding the wireframes according to the user needs or by designing the wireframe any method that the AI agents prefer to use it can use and design the output(not the user decided this method of designing)

The chat section will not be present and will not be shown in the IDE section of the workspace and will be shown only in the preview section.

In the chat section if the cursor icon is clicked in the preview section then it should be able to automatically opens the IDE section and then the wireframe which are selected appears in the screen when the user clicks on the some elements or some components  of that wireframe then that elements of the wireframes are added like a comment for that particular selection is added and then that comment is selected and shown in the chat section like if the user selects on the home button using the cursor icon then that home comment is shown in the cursor and then any changes that the user types about the that particular selects then that only changes should be made.

Multiple selection can be made and multiple selection can be done in the wireframes, when multiple selections are made and then the comments for each selection are asked from the user and the should act accordingly to the changes that the user has made to the selection that the user wants for the elements that the changes to be made for that selected element or elements of the wireframe. 



After making the wireframe design and if the user wants a change in the element then the user the selects the desired elements to be changed in the wireframe using the cursor button which is present in the chat section 
There should be the accept the changes button in the main section of the IDE page in a medium sized and if the user clicks on that button then this phase 2 is completed.

If the user has no changes to make in the design and the user if completely happy with the wireframe that the phase 2 AI agent generated and then there will be a “Accept this design”
button if that button is clicked then the AI agent phase 2 is stopped and then this phase starts to generate the documentation about the changes that are made and the designs that are generated along with the changes that the user has requested and made the changes. 

Then after the documentation is created from the memory of that phase 2 AI agent then that documentation about the design that is made and the pages that is created then that documentation is created either as phase2.md file 

And also the wireframe design that is generated are saved in the new folder as wireframe, and when the development phase that is when the phase 3 starts then the design should be made in from this wireframe only, in detail the frontend that is to be generated should be made keeping this wireframe as reference only, like the placement of elements and the size of the page and the number of the pages that are present in the wireframe design should be exactly the same should be present in the UI and the frontend that is to be generated also.

Phase 3: Development & Implementation
In this phase 3 , from the planning -phase 1 and designing- phase 2 you will get a clear idea of how to implement the features and then you will create a project structure from the both phases above and after creating the project structure you have to ask the user for any changes if not then start building the application by creating the project structure and files 
and start to write code as per the user has asked for.

Teams Involved:
Front-End Development Team - Translates design mock-ups into functional web pages, implements responsive design for multiple devices and screen sizes

For frontend development to use the designs and the assets and the components for css should be Tailwind css and shadcn UI and Radix UI use these for frontend and also using the assets and the components from the online website using the Registry-based Retrieval-Augmented Generation (RAG) and also using web scrapping by using fire crawl and the assets and the components from the website like there will be many website if the user likes some particular design and the frontend of that website then the user can give the link of the website that he/she likes and by seeing and analyzing and getting the complete details of the website that the user gave then the phase 3 AI agent shall proceed to implement that same looking features and design from those websites.

The phase 3 AI agents is divided into subagents using Deepagents and Lang graph + Langchain, phase 3 is a  time taking process were the entire code are written bugs are fixed the frontend is developed and the backend is connected so a single AI agent cannot do all these task alone it can do it all alone but the time and memory consumption will be higher 
So this phase main AI agent is divided into subagents to reduce the workload on the main agent and they are as follows: 

1. Subagent for frontend designing and coding
2. Subagent for backend framing
3. Subagent for frontend and backend integration
4. Subagent for bug fixing and debugging and testing the codes written
5. Subagent for verifying the user need has been satisfied



These subagents are automatically called and executed on its own one by one in step wise the same I have given above. 
But in the chat box section only 1 main phase AI agents will be called that option only will be available but the subagents should be automatically called and start to execute the subagents when this phase 3 is called 






Web scrapping for frontend designing:

For frontend development that is in phase using the AI sub agents to generate modern UI and design I have some websites : 
https://21st.dev/community/components/ 

https://lightswind.com/components 

https://reactbits.dev/ 

https://daisyui.com/ 

https://preline.co/index.html/ 

https://tailwindflex.com/ 

https://dribbble.com/ 

https://magicui.design/ 

https://spline.design/ 

https://www.aura.build/browse/components 

https://www.aura.build/components 


These are some URL’s of some available that using web scraping the elements, assets, components can be used in the application that the user is building. In detail if the user has asked to create some website or the UI, if the user gives the prompt and then taking that prompt as context the web scrapping should happened and those context should be searched across the websites for assets, elements, and templates then if the user need is matched with the websites available in online then that assets, components, or the UI which the user has been asked for should be used in the application that the user is building. 

And also apart from the these mentioned websites the web scrapping must take place across all the list of available websites on internet according to the context of the user that is giving, this is how the web scraping should work


And the AI agent for designing the frontend : 
for the Human in loop how it should happen is like after the phase 2 is completed and after the wireframes are generated the web scraped content and the element and the components should be placed according to the wireframes that are generated, the frontend design should be matched and the elements and the components should be placed only according to the wireframe that is generated and approved by the user, then the AI agent should work and design according to only the generated wireframe.

And for the YOLO mode: the AI agent will automatically design the wireframe in the phase 2 and according to the wireframe that is designed in the phase 2 then the AI agent will work according to the wireframe that is generated and design the frontend according to the frontend that is generated and do the web scarping according to the prompt that the user gave at the starting, this web scarping is optional but if the user has given some links or the URL in the prompt at the chat section then the AI agent should be able to use the RAG method and then the web scarping should happen and find the element, components, or templates that the user has given as reference and then using that the AI will be able to design that component or the website. 

This is the working web scarpping.


After making the frontend the subagents should document their work done in the folder AI agents and then create a new subfolder called as phase 3 folder save the file as subagent-1.md file in the subfolder of phase 3

1. Sub agent - 1 : 
This sub agent should be able to start the designing and then this is the agent which should be able to web crawl through the websites and finalising the designs and getting an idea from the already available websites and make use of the components and the packages(Tailwind CSS and Shadcn UI) and then install them in the terminal  for example : if the user asking for the next js application the command for the next.js like npx command should be installed first and then design the frontend according to the wireframe that is created by the phase 2 and then this subagent should be able to design the frontend according to the user requirement. The frontend design should be exactly what the user have asked and confirmed the wireframe in the phase 2, that wireframes which is created in the phase 2 is saved in the folder called as the wireframes, this AI sub agent should be able to refer that and use that and then design the application accordingly. After completing the work for the Human in loop mode there should be the confirmation of the button in the IDE section like "confirm edit” and “make changes” when the confirm edit button is clicked then the design and the frontend codes are saved and if the “Make changes”  button is clicked then it takes to chat section and then asks for the user to give the input that the changes to be made in the design or in code, and then this subagent starts again according to the user’s input message. And for the YOLO mode all the actions are taken by the AI sub agents itself like if the AI sub agents finds that design is satisfying the need of the user then that Sub agent will automatically accept that design. After the sub agent 1 is completed then the codes for the frontend are saved in the sub folder called as frontend and what are the work done by this sub AI agent 1 are saved as Subagent-1.json in the subfolder phase 3 under the parent folder called as AI agents.


And also I am using the penpot application for the user to design the UI/UX manually by the user : 
This is the latest file I have, after the additional features that you have given me I have added in the application, but in this latest file that I have attached I going to add a new features that is Ui and UX design 


Logo and Icon designing: 

This logo and the icon designing is available only for pro users:

The users should be able to generate and design the icons for the application that they are building how this should work is that: https://openrouter.ai/models?fmt=cards&input_modalities=image 
This is the page which is open router models pages and also it contains the list of AI models for image generation using these AI models then the user can describe how the logo should alike and then the AI models will design the logo according to the prompt.

And the Credit, chats, tokens will be used according to the no.of  tokens consumed and the AI models that are chosen. For example if the user is left with the 4 messages left on that day then if the user decided to generate the logo then the chats will be consumed for that logo generation and that no.of chat will be reduced accordingly by the AI model that is chosen, for example if the user chooses a minimal cost AI model then the token consumption will be reduced, like this it should happen please make this happen. 


Application: Penpot 

Unlike the other open-source applications like semgrep, owasp zap that I have used for testing, I am using the penpot application for UI designing and wireframe designing. The detailed steps are:
In the phase 2 
For Human in the loop mode the user should be given the choice of designing the wireframe or let the AI design the wireframe for the application.
And if the user chooses to design the wireframe for himself then this penpot application should open the main screen where the editing takes place should be in the IDE page of the application.
For YOLO mode the AI itself will be able to design the entire wireframe and the user cannot change anything in these.
And there should be a logo of the penpot in the top section of the IDE page of the workspace page and this should be enabled when the phase 2 and phase 3 starts as when in phase 1 or in phase 4,5,6 like this the penpot should be disabled. and when the phase 2 and phase 3 are called then the penpot application should be enabled.
The designs like then phase 2 and in the phase 3 subagent 1 - wireframes and the actual UI/UX designs that the user has requested for.
There is a visual editor icon present in the chat bar of the preview page and when that is clicked the visual editor should be activated, when activated and when the designs are segregated into elements like buttons, pages, headers, sub headers, graphs like that. And when the particular element is clicked and selected then that is called and should be shown in the chat bar what is selected, the user now has the choice of describing what the changes to be made to the selected or edit manually that design using penpot.
This is how the application should work. Please implement this working in the frontend and also in the backend(python+rust) .
There is a button in the IDE page of the workspace page, when the phase 1 is completed and phase 2 and phase 3 is started this icon will be enabled and then when clicked on this icon the penpot application will be opened, only when the chat generation is completed, like when the AI agent is making some changes in the application the penpot cannot be opened once the AI agent has completed their changes the application will be able to open up the application.
When the penpot icon is clicked then the penpot application should be able to open up, inside the application the generated frontend should be shown in the main section and near that the features, buttons, menus, all those other things will be shown, same as like generating some designs in the penpot website. 

The generated design should be as like separate elements like when the header is clicked inside the penpot section then the header is selected and the changes can be made to them accordingly.  The same thing for the other sections also and all the sections and elements of the application also. 

This is the complete working of the penpot application and integration into my application that I am building. 
2. Sub agent - 2 : 
After the Sub agent 1 is completed their working, the sub agents 2 starts their work by 1st reading and analysing the subagent-1.json file and then getting an idea on what the work has been done by the sub agent 1 and then this sub agent 2 starts building the backend.
This starts to write the logic, API routing, API calling, framework everything in the parent folder called as the backend. This subagent will be able to write the backend code in the programming language that the user has asked for if the user is in Human in loop and if the user is in YOLO mode then the subagent will analyse and for the requirement it decides the programming language to be used, framework, tools on its own, and then writes the codes, and then executes the commands in the terminal. And after the sub agent writes the codes in the backend folder, when the work is completed  by the subagent 2 then this creates the work done in the name subagent-2.json in the subfolder called as phase 3 under the main folder AI agents.

3. Sub agent - 3 : 
After the sub agent 2 is completed the work done, then the sub agent 3 will start to work, firstly it will start by looking into the work done by the sub agent 1 and sub agent 2 and then look into the files, folders that the sub agent 1 and 2 has created and then get the context and get on their work done and then this AI agent will look each and every files in the frontend and the backend. The work of this AI agent is to integrate the frontend with the backend and then make it as a complete full stack application. This Sub agent 4 should be able to integrate the frontend working with the backend working, for example the frontend will just implement the mock authentication and the backend would have implemented the backend separately this is were the sub agent 4 comes into part and then implements the real working of the authentication by the working of the frontend and the backend and providing the user with the real time full stack working application. After the working is done by this subagent then it saves the work that is done by this sub agent as subagent-4.json file in the sub folder phase 3 under the main folder AI agent. 

4. Sub agent - 4 : 
After the sub agent 3 have completed the working then the sub agent 4 will start their work by reading the work that is done by the sub agents - 1,2 and 3 in the file subagent-1.json, subagent-2.json, subagent-3.json, respectively then this sub AI agent 4 will start their work . The main work of this sub agent is to read , analyse , get the idea and working of the application, this sub agent 4 will look up to the above work done sub agents 1, 2, 3 and the work done by them and this sub agent should be able to read the codes - line by line and all the files and the folders and then look for any errors or bugs, If this sub agent finds any error in the codes and the working of the codes then this sub agent will auto fix all those errors(auto - fixing errors) and then it looks again after fixing the errors for more bugs or errors if finds any then auto fixes it - like in a loop the sub agent will look up in the codes  until the errors are fixed. And should be able to execute the commands in the terminals to fix the error, according to the error that is found out.  And If the sub agent 4 completes scanning all the files and the folder then if it finds that there is no error then this sub agent 4 will test the full stack application. The testing will be by everything like testing the API calling, working methodology, API routing, and also will test the frontend working by using playwright MCP server and check for any misconfigurations and also executes commands in terminals and looks for the logs in the terminal if finds any errors or bugs or misconfiguration then this subagent will automatically fix those errors and then test again for any errors or misconfigurations, this sub agent runs 2 times loop for finding the errors in the application:
a. Looking for the errors, Bugs in each line of the code and auto fixes it.
b. Looking for errors, bugs , misconfigurations in the entire full stack application working and then auto fixes it.
And then if there is no bugs , misconfigurations are found then the sub agent will finish their work by saving the work done and saving the changes (if any bugs, errors, misconfigurations found) in the name of the file called as subagent-4.json in the folder subagent under the parent folder AI agent.

5. Sub agent - 5 : 
After the work is completed by the sub agent 4 then the subagent 5 starts before starting the work the sub agent 5 should be able to read get context, analyse the information that are made by the sub agents 1,2,3,and 4 and then read the documentations of subagents-1.json, subagents-2.json, subagents-3.json, subagents-4.json, should be able to read the documentations completely. The main working of the sub agent 5 is to make a documentation and send the chats to the user to test and use the application, same like in the phase 1. This sub agent 5 will be able to send the message in the preview page on how to test the application and then there should be a button in the preview section says” End phase 3 and start phase 4” and also the input like any queries about the application like using the application and the working or if there is any changes to be made in the application. All these kinds of interactions with the user after the application is built should happen in phase 5. If the user asks to make some changes, then the respective phase should work upon and then the changes are made according to the user's request. And if the user is satisfied with the application that is build and f there is no changes to be made and then the user can click on the button “End phase 3 and start phase 4”. This means that the phase 4 is completed. And after the work is completed if there is any changes that is  been asked by the user then this phase will make the changes in the .json file according to the request that is made. For example if the user is requesting the changes in the backend then this phase will make the changes in the backend and after the changes are made then by the phase 5 then the phase 5 will overwrite the subagent-5.json file accordingly. This is what I am saying and also this sub agent will write a work done document in the name as subagent-5.json in the subfolder called as phase 3 under the parent folder AI agents.

Back-End Development Team - Builds server-side logic, develops APIs for communication between front-end and back-end, manages databases and ensures data security
Database Team - Creates and maintains database structures, ensures efficient data storage and retrieval systems
The AI subagents should be able to create a database for the user’s need according to the need that the user has then the subagents should be able to create the backend using the supabase, the backend should be supbase the subagents should be able to connect to the supabase and create table, record , buckets, edge functions, authentication/authorization according to the user’s need in the supbase only that is why I have used supabase.
The AI subagents should be able to create all these automatically on their own in the backend supabase, only if the user have made connection with the supabase backend then only the AI subagents will be able to access and make like changes in the backend and if the user has not connected the supabase backend then the user will have to connect to the supabase backend.

After making the connection then only the subagent which are created using the deepagents and langgraph and langchain will be able to connect using to the supabase 

Full-Stack Development Team - Handles end-to-end development tasks independently, bridges gaps between different development layers

The next subagent will start integrating the frontend with the backend and then starts to make the work of the full application 

This phase should think and work accordingly, and this is time taking process the time taken to complete this phase should be indicated and even if time is taken more also then the AI agent should work accordingly.

All the details like supabase details that are used for the project are to be shown in the side bar which is opened when clicked on the arrow button, initially the header alone will be present in that and the when the backend is created using the subagents and then the user uses the databases and then when the records are stored then in that time the side bar will show up all the details that are stored in the supabase backend.

Each Sub AI agent will complete their work one after the another automatically when the phase 3 main AI agent is called and they will individually make their work done and what the are and the reference as a with each of their name as follows as a document in the .md file format in a separate phase 3 folder and all the 5 subagents will make a document each.


In this phase itself the code should be able to compile, debug and then run. If the user is satisfied there should be a option as accept this and proceed to next phase either in the IDE main page section or in the chat section like an option as like in phase 1 choices only after completing after building the entire full stack application only after all the 6 sub AI agents have completed their work only this button should be shown


Phase 4: Testing & Quality Assurance
Trigger Conditions:
Automatically begins when Phase 3 completes and the user chooses “Accept and proceed to phase 4.”
The system reads and analyzes all outputs and artifacts created during Phase 3, including code files, folders, configurations, and system design.
The status and progress of Phase 4 are visibly indicated in the “Preview” section/chat bar.
And should be able to detect and analyse the CI and CD and pipeline review like that also should be there

1. Automated Security & QA Orchestration
Preparation
Load all outputs from phase-3, including the complete source code, directory/file structure, dependencies, and configuration files.
Test Execution Pipeline:
a. QA Scripts & Unit Testing
Run all available unit tests, integration tests, and any generated QA automation scripts.
Validate that the application behaves per requirements and passes all basic quality checks.
b. Static Application Security Testing (SAST)
Tools Used:
semgrep (multi-language code security scanning)
SonarQube Community (optional for deeper code review and coverage)
Gitleaks (secret/key detection)
Bandit (Python-specific, if applicable)
FindSecBugs (Java/other, if applicable)
Automated Scans:
All code is scanned for vulnerabilities, insecure coding patterns, hardcoded secrets/tokens, misconfigurations, and any deviation from best security practices.
Results are collected as machine-readable (JSON) reports.
c. Dynamic Application Security Testing (DAST)
Tools Used:
OWASP ZAP (run as a REST API server or Docker container)
Nikto (web server scan)
sqlmap (SQL injection detection and exploitation)
Wapiti, XSStrike, (additional XSS/DAST tools)
nmap (network/port scanner)
Automated Scans:
The running instance of the user-built application is analyzed dynamically.
Tests executed for: SQL Injection, XSS, CSRF, IDOR, access privilege escalation, backdoors, DoS, DDoS, API misconfiguration, open ports, and other web vulnerabilities.
Each tool’s output is parsed for vulnerabilities and grouped into severity/impact categories.
d. Manual/AI Review (Optional)
Optionally, the Phase 4 AI Agent can use LLM-powered logic to perform additional semantic/logic checks for vulnerability patterns, business logic flaws, or attack vectors missed by static/dynamic tools.
Results and remediation suggestions merged into phase-4 output.


2. Decision & Feedback Loop
If vulnerabilities or test failures are found:
A detailed summary is generated, listing all vulnerabilities, weak points, recommended remediations, and explicit references to files, lines, endpoints, or components affected.
phase-4.md is created with:
Complete findings/report (including tool outputs and AI suggestions)
List of required changes and recommended fixes
“Call-back” instructions to automatically trigger re-entry to Phase 3 (code generation & agent sub-loop) to revise/patch as needed
This loop can repeat (Phase 3 → Phase 4) until the user accepts results or the application is clean.
If no major errors or vulnerabilities are found:
phase-4.md documents a clean security report and the application is marked as strong.
The next phase (Phase 5: Deployment & Integration) is triggered automatically, requiring no further changes to code.
User Actions:
User can review all findings and remediation instructions in phase-4.md from the app UI.
User can request re-testing, triggering Phase 4 again (for example, after a manual fix or new code push).
Optionally, user can override and proceed, bypassing non-critical warnings.


3. Example Outputs
phase-4.md (Partial Example)
text
# Phase 4: Testing & Security QA Summary

Unit/Integration Test Results
- All tests passed: Yes
- Coverage: 94%
- Failures: None

 SAST Results (Semgrep, Gitleaks)
- High: No critical hardcoded secrets
- Medium: Detected 2 instances of weak input validation (see src/utils/validator.js:24)
- Low: 1 unused dependency (cleanup suggested)

 DAST Results (OWASP ZAP, Nikto, sqlmap)
- SQL Injection: Blocked (no injection point found)
- XSS: 1 reflected XSS found in /search (see details)
- CSRF: CSRF tokens verified
- Open Ports: All non-essential ports are closed
- DoS/DDOS: No vulnerability to basic DoS scripts detected
- API Security: All endpoints require auth, no IDOR detected

 Recommendations
- Escape HTML output in /search (mitigate XSS)
- Enforce server-side input validation in validator.js
- Remove “leftover.jpeg” from /public (unreferenced, risky)

 Pass/Fail Status: FAILED

Next Action
> Calling Phase 3 agents to auto-remediate XSS and validation issues, based on above report.



4. Technical Implementation Notes
Tools (semgrep, zap, nikto) are run as containers or server-side binaries by your backend component orchestrating the AI agent workflow.
Results from all security tools are parsed (preferably as JSON/XML) and summarized by the Phase 4 agent (LLM + logic).
The agent manages orchestration: transition control, automated re-calling, and correct UI status updates.
All findings and changes are versioned & associated with codebase snapshots for traceability.


5. Open-Source Components Used (For This Implementation)
SAST: semgrep, SonarQube, Gitleaks, Bandit, FindSecBugs, Brakeman (language-specific)
DAST: OWASP ZAP (REST API), Nikto, sqlmap, Wapiti, XSStrike, nmap
Auxiliary: Burp Suite CE, metasploit, TheHarvester, as needed for advanced/optional tests
Custom AI checks: Implemented via AI agent itself (optional, for logic/business rule analysis)

6. The open-source application which are used in the application are downloaded and used in the AI agents, and also there are  sub AI agents which are used in this phase 
a.	Sub Agent 1 - for SAST
b.	Sub Agent 2 - for DAST
c.	Sub agent 3 - for reviewing the code written by the AI
d.	Sub agent 4 - testing the CI/CD pipeline
e.	Sub agent 5 - testing the best cyber security practices 

a. Sub agent 1 - These application - Semgrep, SonarQube Community Edition, Gitleaks, Bandit, FindSecBugs, Brakeman,ESLint with security plugins, are cloned in the parent folder and then the this Sub AI agent will be called and then tested the SAST application 

b. Sub agent 2 - These applications - OWASP ZAP, Nikto, sqlmap , Wapiti, XSStrike, are cloned in the parent folder and then this Sub AI agent will be called and then used and then used and tested for DAST application.

c. Sub agent 3 - This Sub AI agent will be review all the codes, files, folder and review each and every line by line code and look for any issues and review each line of code and the working of functions and logics for any cyber threats that is present 

d.  Sub agent 4 - This Sub AI agent will look for the CI/CD and pipelines and then this Sub AI agent will implement the best method

E. Sub agent 5 - This Sub agent will use and implement the best cyber security method and then will test against the cyber attacks like SQLi, CSRF, XSS, Broken injection, IDOR, privilege escalation, DOS, DDOS like these and should be able to test against all the cyber, information, network security. 

7. After everything is completed the each Sub AI agents will save their work done as documents as Subagent-1.md like these for each sub agent should save their work after completing their work by creating a new folder called as phase 4 and then inside this folder only all these sub AI agents will save their work completed documents as .md file 

And then after this phase 4 is completed then the phase 5 is started immediately after this. 






Phase 5: Deployment & Integration
Teams Involved:
DevOps Team - Handles software deployment and operations, ensures continuous integration and continuous delivery (CI/CD) by automating deployment pipelines, manages infrastructure and system integration
Release Management Team - Manages how the system integrates into existing systems, software and processes, coordinates the release process
Change Management Team - Implements change management processes to ensure user training and acceptance, manages the transition to the new system

This phase should be able to form regular CI/CD pipelines and by maintaining the proper security measures.

There should be a export button in the top right corner of the IDE section after clicking on this export button there should be a drop-down menu and should contain: 
1.option for download file locally 

2.and then the cloud deployment services also should be there one below the another all the cloud services should be present including : AWS, google cloud, Azure, Digital ocean, Railway, Render, Digital ocean, Vercel,  netlify, Haiku etc all the popular and mostly used cloud services list should be available and if the user has account on any of these listed cloud services then account can be connected using the credentials of the cloud services that the user has and then after connecting the cloud account the user can deploy their frontend and backend or either backend on their cloud account that the user have connected. 

3. And the button to push the code to the github repo 

4. The button for publishing on the custom domain - If the user has their own domain then they can publish the application that they have created if the application is the web based application and also they can directly publish their application that they created in the website that they have created.

5. And a last button in the red colour delete the project , when clicked on this button  then a dialogue box appears and then showing some precaution as the project cannot be again reused once deleted and then cannot be used again like that warning should be there are at the same dialogue box itself there should be chat box for the user in that if the user has to type the name of the project that the user has created if the name of the project that the user has created if and when matched only then the projected is deleted completely, to make it easier the name of the project will be shown right above the chat interface in the dialogue box, everything is deleted completely all the chats in the IDE session, files , folders, codes, memory stored in the AI, everything will be completely deleted.

If the user is a free user, then he can create only 1 project now that project is created and used. If the user deletes the project the user will be redirected to the plan page only right after the deletion of the project and then even if he clicks on the free plan then he should be able to access the free plan because the free plan allows only 1 project for free user and now the user has to upgrade to the pro plan only, this is the only option for him
If the user is pro plan user then if the user has deleted the project then he/she if they have remaining no. of projects to be used then they can create a new project but if they have exhausted and created all their projects then they cannot able to create any more new project they will have to delete the existing project in order to create a new project.

All these are the UI and the frontend and the backend working should be like this according to the UI and the frontend



After this the phase - 5 should generate the .md file named as the phase-5.md file and should contain all the documents that this phase 5 has done. 

Phase 6: Maintenance & Operations
Teams Involved:
Support & Maintenance Team - Provides ongoing technical support, monitors system performance, handles bug fixes and updates after deployment
Operations Team - Manages day-to-day operations, ensures system uptime, monitors performance metrics and user feedback
Product Evolution Team - Gathers user feedback, plans feature enhancements, manages iterative improvements and updates

If the user has to make a documentation for the application that is made for the viewers to see, the documentation should be able to show the working of the application that the user is making. 

And also if there is any bugs are there are the application is made then the phase 6 should be able to monitor and then make a document on the bug that is found out and then the bug should be documented and then the phase 3 Debugging Sub agent should be called and then the Bug should be fixed and after the Bug is fixed then the next phases should be able to call automatically and then should be able to work accordingly 

This is an optional phase and if the user wishes to implement this also then this phase should be implemented and then the user is used these phase accordingly 

After the documentation is done and over then the phase 6 should be able to make a document about the work done by this AI agent in the AI agent folder as phase-6.md 




1. In the phase 2, I need you to add a test driven development - TDD with the screen shot for the generated wireframe and deisgn, 
2. And also in the phase 2 and phase for frontend development after designing the wireframe the AI agent should be able to satisfy the no.of pages that the user have generated and then if in Human in loop mood then should be able to get confrimation for the user if the accepts then procced with the next part of phases, and if the user comments and asks for any changes by AI then that specific changes should be made and if mannually made by penpot also not a problem, in yolo mode all the work are automatically done by AI agent itself.
3. In the phase 1 after the phase 1 completes the requirement gathering information from the user then should be able to generate the agent skills (https://agentskills.io/home )  .md file, prd file, risk assesment file, user stories file, technical spec file, competetive analysis file, constraints and trade : lms platform file . 
4. In the testing part - phase 4 the testing part there should be some inbuild test functionalities with the codespace and the requirement document the AI agent should be able to compare them weather the requirement is completely satisfied or not, and if not completely build then the missing or partially(skelton) features should be listed and then again the phase 3 AI agent should start their work by implementing the missing featuures. 
5. In the same phase 4 - The AI agent should write  test cases (as per to user requirement for building the application) for the application and when the application pases those test case, the application is marked as completed and also there should be black box testing - user stories on the user's POV the testing should happen and white box testing - examines the internal struructure, architectture, system works, actual code implementation. For white box testing use of .xml file which conatin multiple sections and sub sections of test to navigate thorugh the codespace and test the application and write the white box and black box testing file respectively.
When the project is created by the user and the phases are completed the structure should look like- 
The structure of the application: 
Project/
├── ai-agents/
│   ├── phase-1/
│   │   └── phase1.json
│   ├── phase-2/
│   │   └── phase2.json
│   ├── phase-3/
│   │   ├── subagent-1.json
│   │   ├── subagent-2.json
│   │   ├── subagent-3.json
│   │   ├── subagent-4.json
│   │   └── subagent-5.json
│   ├── phase-4/
│   │   ├── subagent-1.json
│   │   ├── subagent-2.json
│   │   ├── subagent-3.json
│   │   ├── subagent-4.json
│   │   └── subagent-5.json
│   ├── phase-5/
│   │   └── phase5.json
│   └── phase-6/
│       └── phase6.json
├── wireframes/
├── frontend/
└── backend/
Here I have given the parent(main) folder simply as “project” but actually the name of the project should be the name of the project that the user created. Whatever the name of the project then that should be the parent folder please make the backend working like that.
For example, if the user creates the project name as “test” then the name of the parent folder should be “test”. Please implement the working according to it.

Security features:

The AI agent folder should be securely stored and should not be exposed, because this file contains many important information like working, codes and everything that are used for building the application so this application should be very carefully hidden

And per day for the free plan the Users can be able to chat with the AI and the AI agents only 10 messages per day and also can be able to create only 1 project for free user after the user trail period of 30 days have ended then the user will have to download to project that he/she has been created because after the trail period ends within the next 10 days the projects and the database that the user have created will be deleted.

2FA for authentication: 

 How 2FA Works with Authenticator Apps

Authenticator apps like Google Authenticator, Microsoft Authenticator, and Cisco Duo use the TOTP (Time-based One-Time Password) algorithm to generate temporary codes for two-factor authentication.  These apps create 6-8  digit codes that refresh every 30 seconds based on a shared secret key between your device and the server.

The TOTP Mechanism

TOTP authentication relies on two components working in sync: a shared secret key and the current time.  When you first enable 2FA on a service, the server generates a unique cryptographic secret and presents it as a QR code. You scan this code with your authenticator app, which stores the secret locally on your device. Both your app and the server now possess identical secrets.
Every 30 seconds, both parties independently calculate the same one-time code using the shared secret combined with the current timestamp divided into fixed intervals.  The algorithm uses HMAC (Hash-based Message Authentication Code) with SHA-1, SHA-256, or SHA-512 to generate these codes. When you log in, you enter the code from your app, and if it matches what the server calculated, authentication succeeds. Since this happens locally without transmitting codes, TOTP is resistant to man-in-the-middle and SIM swap attacks.

There is button in the settings page to enable the two-factor authentication, the QR code or entering the code manually, like this the option should be present please make it like that, but I have not created any frontend pages for it, once the backend is configured then the frontend page can be created.

Working of the Side bar : 

About the side bar it contains these :
              1. Overview 
               2.Database 
               3.Users 
               4.Storage 
               5.Edge Functions 
               6.AI agents
               7.Secrets 
               8.Logs
1. Overview : It should generally contain the list of these : Database
View tables and edit data
Tables
Tables will populate as soon as your app saves information
Users
View user data and configure how users sign up
Signups
Auth settings
Storage
View and manage files, images, and documents
 Buckets
Buckets will appear here when users upload files
Edge Functions
Configure functions executed in your app
Functions
Edge functions will appear when adding custom background actions
AI
View AI usage and performance
Secrets
Store and manage environment variables securely
Logs
Monitor application logs to debug issues
Usage
Advanced settings

These are the overview of the subsection that is present
2. Database - In this all the details - records, tables, columns, rows and all the authentication details should be present.
3. User: the authentication details should be present like for the application that the user is building all the user details should be present in this 
4. Storage/ buckets: The application that the user will build in that these details should be present, like for example if the application that the user is about to build contains something like file upload then the uploaded files should be present here.
5. Edge functions: The edge functions also should be present for the application that is building by the user like simple mail sending to the user otp verification like these ( I am telling only simple features, but the backend code should be able to implement all the features)
6. AI agents: Actually, this AI agent is mainly for the YOLO mode when the users are in YOLO mode then the user can upload the file that contains the details of the application that is about to be built in this AI agent.
This is the phase where all the AI agents and the Sub AI agents will be present but since the phase has not been started and the application has not been started to build, In this AI agentic phase the AI agents and Sub AI will be trained according to the specific work that is needed to be done. In this section the user should have the ability to put the message instruction in the phase whichever he wants and then the AI agents will take that as the memory and then it will work taking that as an input that the user gave and store it in its memory.
7. Secrets/env variables: this is the place where all the credentials are stored as secret and should be exposed. like in this there should be 2 parameter names and the value. The name should be the name of the credentials that are about to be used and the value is the actual credentials that are to be used. When building the application, the AI agents and the Sub Ai agents should not create any files like .env,  .env.local like these in the application to be built by the user
All the credentials are to be stored and saved here and the application should be able to use these credentials only from this place please implement like this.
8. Logs: All the activity that is been done to create the application that the user is being build should be shown here, like what are the changes made in code and how many users have logged in and how many hours the application is online and how many time the application is online 
The entire statistics and the Data should be shown in this logs section, there should be graphs, charts to make the visualizations also.
These are the working of the 8 sections of the side bar.
These features will be available to the users only when they have connected their account to supabase backend. 
As for running and testing the application within the Pakalon virtual environment then the supabase itself is enough but when the application is ready for production then the Pakalon application will execute the phase 5 and the AI agent will connect to the cloud services that the user has connected their account with and then all the details in the sidebar and the application that the user has built should be pushed to the cloud 
Applications and the features that the pro and the free user can access:

For free users: 
 Bandit, FindSecBugs, Brakeman,ESLint with security plugins, sqlmap , Wapiti, XSStrike

For the pro users: 
Semgrep, SonarQube Community Edition, Gitleaks, Bandit, FindSecBugs, Brakeman,ESLint with security plugins, OWASP ZAP, Nikto, sqlmap , Wapiti, XSStrike, Penpot, and the Image generation feature, 

Sandbox/ isolated environment features in the workspace:

When the workspace page is created the Webcontainer API should start and the monoco editor should be present there, now in the frontend the simple monoco editor is present but there is no real working, but when the project is created and started it should start the webcontainer and API in the IDE page of the workspace page, the IDE page should be able to run, compile, more than 80+ programming languages and framworks, the terminal should be able to execute the commands, the api key of the webconatiner by stackblitz will be given you have to call that API key and use them in the application. 

The IDE should be a real IDE and all the functions and working should as same as other code editors like vs code and cursor. 

Deepagents + Langgraph + Langchain + Langsmith Implementation and usage: 
To create the AI agents, each phases should be created using Deepagents + langgraph, Langchain, langsmith and langflow. The AI agents should be created and then those AI agents will generate code and build application for the user as the user have requested. 

Credentials needed:


Services to be used 	Usage
Supabase credentials	For storing the users record and the projects that has been created by the user
Firecrawl API	For webscrapping
Brevo Mail service	For sending email notification 
Polar API key	For payment gateway
Polar product ID	For product purchase
Openrouter API key - for free users	To choose AI models for free users
Openrouter API key - for pro users	To choose AI models for pro user
Any cloud services (optional)	To deploy the application online
Github O auth(Via Supabase authentication)	For authentication (only by using Supabase authentication)
Webcontainer API key	 For sanbox
Logo.dev	For using 3rd party application
Tanstack - AI SDK credentials	The same key as Openrouter API key for AI models usage

These credentials are to be made and created in the backend of the application, these are for the developers usage and not for the users. These credentials should be stored and made securely in the backend and not on the frontend and these credentials and the AI agent folder both should not be exposed. 

And the credentials that the user needs to bring are : 
Supabase credentials - for database, authentication, buckets, edge functions, etc.
Github (Optional)
Any cloud account (optional)


Usage, plan and billing : 

1. About the account - only the user can be able to login or create a new account using only github authorisation via the supabase credentials, like I have already configured the Github o auth client ID and client secret in the supabase authentication provider so the Github authentication should be via the supabase only and there are some restrictions :
For a free account when the free trial for 1 month is over after that the user should not be able to delete that particular account. And also even before the trail ends if the user deletes the account the account projects, database and the user saved details  should be deleted but if the user deletes on the 10th day of the trail period then if the user creates the new account using the same github account then that user has only remaining 20 days of free trail, This method prevents the users from using the same account again and again and misusing the free trial.
For pro account - The method should be like pre paid if the user pays 15$ at the starting of the month he/she will be able to use that account for the next 30 days without any disturbance and at the last 7 days the user will be sent with the mail notification and also in the application for recharge the bill, the user will be given with extra 3 days of time to recharge the bill, the billing cycle for the pro plan starts from the day when the user starts or converts to pro plan - the next 30 days from the day of start : day 0 to day 30.

2. There should be 10 messages free for users and 25 messages for the pro user daily. And for the free user if the daily 10 messages are completed then if the user tries to send any message in that particular day (for the day when the daily 10 messages are completed) then the upgrade plan should pop up, and the user should be able to send any message only on the next day after the 2.00am (local time). 
And for the pro user the pro plan should not pop up after the daily message are completed, they have to wait till the next day the dialogue message should say as The daily limit for <particular day> has been completed and wait till tomorrow to continue building the application.

3. The autosave method should be there  like the user should be able to start his/her work from the place where he/she has left example : The a free user has only 10 messages per day and till the 1st day he may have did something and progresses up to something if he starts the next it should be able to start from the place where he/she has left on the previous day i.e their progress should be saved.


Additional Informations : 


1.  I wanted to build the AI agents as phases and then pass information from one phase to another, these agents are given with specific set of instructions and commands despite the AI models that are being used whatever the AI model can be but the AI model must be integrated in the code editor to make these phases happen, better AI model and AI model provider better the results, the working of the phases is I have given to you in that according to each phase (AI agents) they to their work accordingly as per the user instructions or prompt that is given I wanted to use AI-ADK/SDK
I wanted to use openrouter in the application and I will be using the API key of the openrouter, for free user I will give a separate API key and then for pro user I will be giving another API key that is a paid API key the pro user only should be able to access the paid API key. When implementing the openrouter as the AI model provider make sure that all the AI models which have been released and also the AI models which will be released in the future also should be implemented in the new to old order, the newest model which is released newly then that should be appeared first. 
For free users only the free models can be accessed by the free users and for the pro users they can access all the models that they desire to use which are available in the openrouter.
https://openrouter.ai/models 
This website contains the list of the models please implement the models that are available in this website

2.  The autosave method should be there  like the user should be able to start his/her work from the place where he/she has left example : The a free user has only 10 messages per day and till the 1st day he may have did something and progresses up to something if he starts the next it should be able to start from the place where he/she has left on the previous day i.e their progress should be saved.

3. I wanted to implement the import from figma so that the designs that I have made are imported from figma and then after importing the frontend I wanted to start from the phase 1 and how this should work is that If the user is attaching a figma file and then the phase 2 which is for designing should be able to analyse the design that is attached from figma, if there are any minor changes to be made that alone can be made and then proceed to the next phase.

4. The phases / AI agents features which I have mentioned should take place and should be able to interact with user via the chat box like for example in the phase 1 : it will ask for the tech stack from the user and if the user has given some tech stack that will be kept in the memory of the AI agents and then proceed with brain storming session like the AI agents asking more and more doubts and details from the user about the tech and the description and the requirement to build the application if suppose the user does not have that much knowledge in the tech stack the AI agent will give some suggestions and if the user accepts that tech stack and requirement then that information are stored in the memory of the AI agents and AI sub agents for implementation and then after each phase all those information are stored as .json file for passing that information from 1 phase to another, Like each phase/AI agents when completing their work should document their memory and work done every information they have that is regarding to the project as .json file

5. The user also has the ability to skip the human in loop method which I have described above like in the same chat box there should be 2 options
a. Human in loop
b. Yolo
a. Human in loop mode - means that the user will have an interaction with the AI agents and sub agents in each phase, there will be a communication with the user and the application is completely built according to the users requirement.
b. Yolo mode - There will be no interaction with the user all the tech stack and the all the features, working , design, everything will be determined by the AI agents and their corresponding sub agents only
7. There should be the ability of calling the AI agents - phase 1 to 6 ( which I have given in the attached files), In the chat box itself there should be an option - when clicked on the “+” plus icon of the and then the slash “/” icon - this is to  call the AI agents and then telling that AI agents to do some work that the specific AI agents and their sub agents are supposed to do for example : If the user is in phase 3 - coding stage and suddenly if the user wishes to change something in the application design or frontend then he/she stop the current phase and then call the phase that they want to work with and then the complete that phase and then the AI agents will mark the changes in the .json files and then the phase which the user has left previously will look up to that .json file and then start implementing the application according to the changes made

8. Based upon the plan the user should be able to use the AI - using Tanstack AI SDK : 
 For free plan : The user will be able to use only the free models and not every models 
 For pro plan : The user will be able to use all the AI models that are listed 

9. About the account - only the user can be able to login or create a new account using only github authorisation and there are some restrictions : For a free account when the free trial for 1 month is over after that the user should not be able to delete that particular account .
And also even before the trail ends if the user deletes the account the account projects, database and the user saved details  should be deleted but if the user deletes on the 10th day of the trail period then if the user creates the new account using the same github account then that user has only remaining 20 days of free trail, This method prevents the users from using the same account again and again and misusing the free trial.
For pro account - The method should be like pre paid if the user pays 15$ at the starting of the month he/she will be able to use that account for the next 30 days without any disturbance and at the last 7 days the user will be sent with the mail notification and also in the application for recharge the bill, the user will be given with extra 3 days of time to recharge the bill, the billing cycle for the pro plan starts from the day when the user starts or converts to pro plan - the next 30 days from the day of start : day 0 to day 30.

10. In the UI there will be a button called publish in that there should be the option for the user to deploy the project in all the cloud services : AWS, google cloud, Microsoft Azure, digital ocean, Haiku, Render, Railway, Hostinger, etc like all these.


These are some websites from these websites and also apart from these websites there will be some assets and components providing websites will be there from these and those websites using Registry-based Retrieval-Augmented Generation (RAG).
Registry-based Retrieval-Augmented Generation (RAG) :  The application maintains a curated registry.json index that acts as a map, linking semantic descriptions (e.g., "interactive 3D globe") to the raw source code or API endpoints of high-quality external components (such as React Three Fiber snippets or Spline embed codes). When a user requests a specific 3D design, your system searches this registry for the best match, programmatically fetches the component's code definition, and injects it as "context" into your Large Language Model (LLM). The LLM then generates the final frontend page code by treating this fetched 3D component as a verified building block, automatically handling the complex imports and configurations required to seamlessly integrate the external asset into the user's project


11. For payment gateway - The payment gateway is polar, the users needs to pay the amount of 20$ per month excluding the tax ( depends upon the county the user is residing in)  for the pro users


12. The paid user will be sent with the email notification on the last 7 days( for the last 7 days each day each mail about the remainder about their bill due)  from their due date, this is some kind of remainder to the user to renew their plan and then continue their access to the Pakalon AI code editor without any issues. And also the free users also will be sent with the email notification for the last 7 days - each day each mail for the expiration of their free trial account.

13. I have given the logo of the application that is used to build the application in the folder called as resources, the logos with different file types from .svg , .png everything for the Dark and the White theme also I have pasted, use the logos like that accordingly.

5. Also these : 
Semgrep, SonarQube Community Edition, Gitleaks, Bandit, FindSecBugs, Brakeman,ESLint with security plugins and OWASP ZAP, Nikto, sqlmap , Wapiti, XSStrike.
These downloaded and placed inside the parent folder and then these applications are used and then these should be used in the phase 4, the used applications are used inside the phase 4. The application will be installed in this folder and then the phase 4 AI agents and the Sub agents of this phase 4 AI agent will use these installed open source applications and then do the necessary testing and review actions. 

6.I am using openrouter only for AI models and also all the models which are in the openrouter and which are free for using should be present for free users and all the paid and pro models shall be available for the pro users , the pro users will be able to access to all the free and paid models also I will be using only 1 API key thorugh out so the backend logic and working should be like if the user's is on pro plan then the backend logic should be able to identify whether the user is pro user or free user everytime when the user's login and if the user is free user then he/she will be able to use only free tier models only.



This above was the complete working of my backend, when I have deciced that the application was web application, now since I have converted it to CLI based, please change the working also and give me a updated working of the code, with having the context above from previous chats

And also In the application I have given as saving the context as .json please change that completely to .md file, like phase1.json would be above but make it like phase1.md 
And explain everthing by text only no code explaination needed for now, when I tell you that time you can give me code explanation, and also I have included to use mem0 which is the memory tool to remember the context and chat as memory which makes the application from stateless to statefull, I have decided to use it as via docker image same as like using other open source application

And add this also : n the phase 2, I need you to add a test driven development - TDD with the screen shot for the generated wireframe and deisgn,

2\. And also in the phase 2 and phase for frontend development after designing the wireframe the AI agent should be able to satisfy the no.of pages that the user have generated and then if in Human in loop mood then should be able to get confrimation for the user if the accepts then procced with the next part of phases, and if the user comments and asks for any changes by AI then that specific changes should be made and if mannually made by penpot also not a problem, in yolo mode all the work are automatically done by AI agent itself.

3\. In the phase 1 after the phase 1 completes the requirement gathering information from the user then should be able to generate the agent skills (https://agentskills.io/home ) .md file, prd file, risk assesment file, user stories file, technical spec file, competetive analysis file, constraints and trade : lms platform file .

4\. In the testing part - phase 4 the testing part there should be some inbuild test functionalities with the codespace and the requirement document the AI agent should be able to compare them weather the requirement is completely satisfied or not, and if not completely build then the missing or partially(skelton) features should be listed and then again the phase 3 AI agent should start their work by implementing the missing featuures.

5\. In the same phase 4 - The AI agent should write test cases (as per to user requirement for building the application) for the application and when the application pases those test case, the application is marked as completed and also there should be black box testing - user stories on the user's POV the testing should happen and white box testing - examines the internal struructure, architectture, system works, actual code implementation. For white box testing use of .xml file which conatin multiple sections and sub sections of test to navigate thorugh the codespace and test the application and write the white box and black box testing file respectively.


And also In the chat interface when the command / slash command is typed all the phases from 1 to 6 will be listed but upon completion of one phase only can be able to move to another phase, 

And also when typed as /plugin the list of plugins should be shown which are available in the marketplace

And also the interaction between the user and the AI agent should be like choosing the choice(like now how choosing of choices is in claude code)
And also pakalon CLI must be able to use all the commands that claude code and github copilot CLI uses (like bash ,grep, read)

And also in the chat interface there should be button called as visual editor as now have mentioned in my doc above when clicked on that and open the design and if the user needed to change some sections or elements of the design then if he/she clicks on that design then that particular selected  design is selected, and shown in terminal chat section and when the elements are clicked whatever the sections that are clicked are shown in the terminal and after that the user types on the chat interface and gives the requirement as prompt and only on that selected places only the changes should apply (this feature in available in v0 and loveable) 

Whenever the user opens the terminal, the backend checks that if the user is logged or not and if logged in then checks for usage if the credits are over and completed then cannot send or interact with the application, if credits are remaining then can be able to interact and chat with the application, 

About the project I have given as 1 projects can be used by free users and pro users it is 5, as I was building for web application, since the application is build on CLI that ideology of project is not required, instead the credit based system is used, by tracking down credit usage by tracking machine ID and saving them( The credit tracking should be like cursor, claude cli, droid cli) 

In the chat interface there should be a option for copy pasting the docu in the terminal, and then interacting with the AI agents. 

And about the sidebar features, no need for that entire sidebar features and working. 


And about 2FA, During login process there will be a codes will be displayed in the terminal and should copy paste that code in the website and if the code matches then can login and authenticate and start using the application. 



Applications and the features that the pro and the free user can access:

For free users: 
 Bandit, FindSecBugs, Brakeman,ESLint with security plugins, sqlmap , Wapiti, XSStrike, Mem0

For the pro users: 
Semgrep, SonarQube Community Edition, Gitleaks, Bandit, FindSecBugs, Brakeman,ESLint with security plugins, OWASP ZAP, Nikto, sqlmap , Wapiti, XSStrike, Penpot, and Mem0, 


And about the image generation, that part is also not needed, please remove that also. 

And also when clicked on escape 2 time the chat generation is intercepted, and when clicked on ctrl + j or shift + enter new line is entered

 how I have taught is like, since the phase 2 required some UI, there is a plugin in claude code called as 
 claude code canvas : [https://github.com/dvdsgl/claude-canvas ](https://github.com/dvdsgl/claude-canvas )
It allows some visual representation, so when using this the application's UI or wireframe can be shown, or instaed the wireframes that are generated in phase 2 can be opened in browser like by running via localhost, Is this method is possible
And about the sidebar features, the doc which I gave to you contains the sidebar features that is just the frontend bridge between the user and the backend where all the functionalities will be saved, so instead of that sidebar, let the features of sidebar directly be stored in backend and the working of the sidebar can be called from backend, will it work
And about the penpot integration since my description is given as web application, using of it will be complex but instead, like as mentioned above, if the build wireframes and design if opened locally then using penpot 
And about the 3rd open source appilcations using of docker image, all the applications can be used as docker image. 


Actually there are some additional features like, In phase 1 there are some additional features like If the user gives the complete tech stack about what should be build to the application, then for clarification again the phase 1 AI agent will ask some general questions, 
For eg : If the user gives the prompt as "Build me a complete website for e commerece, frontend - html, css, js and backend - Supabase." If the prompt is like this then only some extra questions should be asked like, which tech stack can be used for authentication and payment like that some follow up questions can be asked 
And if the user gives a plain prompt for eg: "Build a ecommerece website" Then the ques like For what purpose the application is build? what can be the tech stack? Who are the application's target auidence? and etc like these the follow up questions should be asked and minimum of 10 questions to be asked and the user's response to those questions (answers) are saved in memory (may be mem0) 
And when asking each question the last option for the user to choose is end phase 1, when this is clicked the phase 1 stops and all the .md files are generated and the contents are filled and then the next phase 2 starts to executes, if the user chooses some other option instead of this end phase 1 then the follow up questions should continue. 

And another feature that I want to add is that the phase 1 AI agent should be able to create 2 more markdown files, they are plan.md and tasks.md. Based upon the prompt that the user gave and the interaction that is made between the user and the AI agent, based upon those chats the plan to build the entire application is created on the requirement of the user and after the plan.md is created and in this file the entire plan, requirement, specification, everything should be mentioned and then from the plan.md file and the memory of the AI agent then the tasks.md file is created, in this file based upon the user requirement and the follow up ans the tasks are created like to build the entire application, each phase is split up into tasks and then the application is build accordingly. 
this plan.md and taks.md should happen before the phase1.md, this phase1.md is mixture of all the files that are present in phase 1 sub directory, everthing that are present in each file will be present in this file but in a short manner, the detailed description will be present inside each files only.

And also in phase 1should create  another markdown file called as  design.md file which creates the complete skills on telling how the design of the application should look like, by having this file only the phase 2 should start building wireframes and then phase 3 should start building the actual frontend design
This follows up agent skills by vercel : 
1. https://github.com/vercel-labs/agent-skills 
2. https://skills.sh/vercel-labs/agent-skills 
3. https://github.com/nextlevelbuilder/ui-ux-pro-max-skill 
These are some skills that are present, when the user gives some ideas and design from these skills repo the phase 1 AI agent should find out what skills would match the user's requirement and then use it in the design.md file. 
These repos should be used and the skills from these should be used in the design.md accorindy to the user requirement

And also the features of MCP servers should be enabled, https://github.com/modelcontextprotocol/servers 
All the listed MCP servers can be used in pakalon by installing them 
In the chat interface it the user wants to add any mcp server then if the user types the name of the mcp server and the link of it, the mcp server should be added, and there should be a option to add mcp server for pakalon either in the project directory or global installation, 
If global installation, the mcp servers which are installed will be stored in .pakalon folder in the local disk c/users and if the project directory installation then the mcp servers are installed in .pakalon/<project_folder> directory 
~/pakalon-projects/
└── {project-name}/
    ├── ai-agents/
    │   ├── phase-1/
    │   │   ├── phase-1.md
    │   │   ├── agent-skills.md
    │   │   ├── prd.md
    │   │   ├── risk-assessment.md
    │   │   ├── user-stories.md
    │   │   ├── technical-spec.md
    │   │   ├── competitive-analysis.md
    │   │   └── constraints-and-tradeoffs.md
    │   ├── phase-2/
    │   │   ├── phase-2.md
    │   │   └── tdd-screenshots/
    │   ├── phase-3/
    │   │   ├── subagent-1.md
    │   │   ├── subagent-2.md
    │   │   ├── subagent-3.md
    │   │   ├── subagent-4.md
    │   │   └── subagent-5.md
    │   ├── phase-4/
    │   │   ├── subagent-1.md
    │   │   ├── subagent-2.md
    │   │   ├── subagent-3.md
    │   │   ├── subagent-4.md
    │   │   └── subagent-5.md
    │   ├── phase-5/
    │   │   └── phase-5.md
    │   └── phase-6/
    │       └── phase-6.md
    ├── wireframes/ (Penpot SVG/PNG exports)
    ├── frontend/ (generated Next.js/React code)
    ├── backend/ (generated Supabase/FastAPI code)
    └── pakalon.db (local SQLite - credits, state, memory)

This file structure which you gave above in the previous chat also should be saved in .pakalon folder of the respective project directory 

And how this structure ( this above given structure is old and the updated files are mentioned above, the new file structure only I am talking about) would run is that when the /init command is run the updated file structure is created and then the contents inside them is initially empty and then when each phase starts their work the contents are filled according to the work of each AI agents and sub agents. 
If the file structure is already present inside the .pakalon folder then it would ask permission for overwriting the contents inside the folder, if the user allows to overwrite then the new structure is created and then pakalon application and the AI agents will work according to that contents of the files, and if the user declines overwriting the file structure then the application and the AI agent will start working of what is already present inside it only. 
If the user doesnot know about running the /init command, then if the user is Yolo mode the init command is automatially run and the .pakalon folder is created and if the user is in Human in Loop Mode(HIL) then it would ask for permission from the user and then run the command and then create the folder. 

And also there should be tool calling feature should be present in the application like running some commands like reading, viewing, editing, deleting files folder and accessing web like that should be present

And also the use of vercel's agent browser should be present, 
https://github.com/vercel-labs/agent-browser  
This is the complete documenttaion and report for use of this agent browser, this agent browser is used in phases 1,2,3 and 4 
Like if the user gives the link/URL of some website and asks pakalon that "I need the design elements mentioned in this website and the theme and styling also" if the user asks something like this then along with the help of the firecrawl- web scarpper , this agent browser should analyse and find out the styling, colour those are present in that website and then update those styling or whatever the user asked from that website into design.md 
And also after generating the designs, the generated design will be opened in local host (browser) this agent browser will look into and starts performing their work and then will compare this design with the phases 2's wireframe generated and also with the user's requirement and verify allignment and everything, if it finds everything is perfect and correct then it proceeds to the next subagents. 

And in the phase 2 and phase 3, the test driven development will happen like with the help of agent browser the AI agent or sub agent will look into the design that is generated and verify if the frontend is build according to the user's needs and then will take a screen shot and save that screen shot into the respective phase like if it is in wireframe generation, then save it into phase 2 directory, only if the user approved( Human in Loop mode, For Yolo mode it is automatically approved), and if not approved then the AI agent will ask for modifications and changes through the chat interface, and then the AI agent will look into the screen shot for which part the user have asked to changes and then comes to the wireframe that is generated and then makes changes to that wireframe according to the user's requested change. 

And the application should have the image analysis capabilities, unlike google's antigravity, cursor and claude code cli, when given any screen shot of image should be able to analyze what is present in that image and then work accordingly. And also should be able to view the video and analyse the video 

And also in the phase 3 during the testing part, after the entire application is build during the testing part of the application, pakalon application will start the application in local server, the frontend and backend (if backend exist) and then with the help of the chrome mcp dev tool : https://github.com/ChromeDevTools/chrome-devtools-mcp , the application that the user has created should open in chrome browser and then the  chrome Dev tool MCP will act upon, and test the application like, if the application is about filling out forms or applying to job, then the chrome MCP dev tool and agent browser should test each buttons test the working of the application and then after testing the entire application, and then give the phase 3 agent a complete report about the working of the application if there are any errors are there like that everything it should be reported along with the screenshot and screen recording of the application, then the AI agent will look that screenshot and screen recording and read the report that is generated and find out the issue or errors and if any of them are present then this subagent will allocate the work to that respective subagent and fix that issue or error. This is the working of testing part with chrome dev mcp tool and agent browser. 

And In the same phase 4 - The AI agent should write test cases (as per to user requirement for building the application) for the application and when the application pases those test case, the application is marked as completed and also there should be black box testing - user stories on the user's POV the testing should happen and white box testing - examines the internal struructure, architectture, system works, actual code implementation. For white box testing use of .xml file which conatin multiple sections and sub sections of test to navigate thorugh the codespace and test the application and write the white box and black box testing file respectively.
Should create whitebox_testing.xml and blackboxtesting.xml file and test acordingly. 

And also the application must have the capablity of pushing the application that the user is build into github and create pull request and find issues and debugg them - phase 5 

And about the autentication - I will create a website in that website the payement and authenication will be present. Like the user can install the application via command like, and the application will only start if the user is authenticated and then if the user wants to upgrade to pro plan, the interface and the payment gateway will be present in that website will I will create, for authentication, if the user is already logged in then the application will open and start and if the user is not logged in then it will redirect to the website from terminal and ask the user to log in and then show the 6 digit code in the terminal and the should copy and paste that code if the code is correct and matched perfectly then the application should be run. 
Even if the user is logged in website and opening the application in terminal 1st time this copy pasting of 6 digit code methodology should work. 
And also about the usage and tracking of the application during the installation, pakalon generates and stores unique machine identifiers such as telemetry.machineId, telemetry.macMachineId, and telemetry.devDeviceId in the local storage.json file (e.g., ~/.config/Cursor/User/globalStorage/storage.json on Linux). These IDs uniquely identify the device/installation and are used alongside account info (email/name) to attribute usage, detect suspicious activity (e.g., trial abuse), and enforce limits. Deleting or resetting these IDs (via commands like Ctrl+Shift+P > "Fake pakalon") creates a "new machine" illusion, confirming their role in tracking

It captures IP addresses for geographic location (security/performance), device/browser/OS details, log/error data, and timestamps of access. Usage metrics include AI-specific events: total prompts/tabs, AI requests, line changes (additions/deletions) by Agent/Tab, accepts/rejects of suggestions, chat interactions, and active user status (e.g., if suggestions received or Composer opened). Data is sent to pakalon servers during online use; offline actions aren't tracked.
Privacy Controls
Privacy Mode (in settings) prevents model providers from retaining data and stops /third parties from using code for training, but some code/usage data may still be stored for features. Cookies/trackers personalize/analyze sessions; admins export detailed CSVs/APIs for teams. No sensitive data collected; aggregated/de-identified stats used for improvements

Commands :
--add-dir <directories...>                        

  --agents                                  
  --allowedTools, --allowed-tools <tools...>       

  -c, --continue  
-r, --resume                                 
  -d, --debug [filter]                              
  --debug-file <path>                               
  --disallowedTools, --disallowed-tools <tools...>  
--defaultModel
--fallbackModel
  --fallback-model <model>                          
  --file <specs...>                               
  --fork-session                                   
  --from-pr [value]                                 
  -h, --help                                        Display help for command
                         
  --max-budget-usd <amount>                        
  --mcp-config <configs...>                       
  --mcp-debug                                     
  --model <model>                                                                                   
  --permission-mode <mode>    - Human in loop, YOLO                      
  --plugins
  -p, --print                                       
                                          
  --replay-user-messages                            
  -r, --resume [value]                             
  --session-id <uuid>                               
  --setting-sources <sources>                       
  --settings <file-or-json>                         
  --MCP                    
  --tools <tools...>                                
  --verbose                                         
  -v, --version                                     

Commands:
  doctor                                           
  install
  mcp                                              
  plugin                                            
  setup-token                                       
  update

/init
/plugins
/models
/workflows
/directory
/agents
/web
@- mentiones files and folders



And also there are some additional features and corrections that I wanted to make in this application 
1. Now I have given as when "/init" command is run then the .pakalon folder is created and the file structures also created inside that, but if the user simply asks some requests like make a change to css or ui to some exsisting projects my methodology wont work, for this method if the user simply asks some changes to the file or folder by entering the prompt the Agent coding capablites(tool calling, file edititing)  helps them to complete their task, when my methodolgy comes to play is that when the user is about to build some big full stack application or something else, that time when the user types as"/init" only .pakalon folder is created and all the file structure is created and then the phases from 1 to phase 6  agentic AI should start. If the project is already built to some extend then when the user initialses /init and then this command should understand what the project is about and about till what the user has created, for example if the user wants to create some e commerce website and already build 50% of the application using his own tech stack then the AI agent should be able to analyse this project codebase and then automatically fill the markdown files like
    
    |   |   |   |---plan.md                # Build plan (NEW)
    │   │   │   ├── tasks.md               # Task breakdown (NEW)
    │   │   │   ├── design.md              # Design specs with Agent Skills (NEW)
    │   │   │   ├── phase-1.md             # Summary
    │   │   │   ├── agent-skills.md
    │   │   │   ├── prd.md
    │   │   │   ├── risk-assessment.md
    │   │   │   ├── user-stories.md
    │   │   │   ├── technical-spec.md
    │   │   │   ├── competitive-analysis.md
    │   │   │   └── constraints-and-tradeoffs.md

Subagents 3.md, subagents4.md like that. And if the project is not fully completed then upto which portion the project has comepleted till that the filling should happen. And also if the user has mentioned that no frontend design is needed then the frontend should remain the same. This is the complete working of pakalon methodolgy
The application can work even when .pakalon folder is not initalisied also and even when initalised also, so the working is divdied into 2 paths like when /init is run and when /init is not run.


And about the AI model implementation, I am using openrouter for model provider, Like using Tanstack AI SDK and I will be using openrouter as model provider, For free users all the free models can be used and for pro user, all the models can be used, I will be using 1 main API key for pro as well as free users and based upon the type of user either pro or free user, the AI models can be used accordingly.

And there are more than 550+ models are available in openrouter, everyday there will be some new models that will be released to inherit and use those models into my application, there is a method of dynamic scaling and dynamic refreshing of models daily that way I wanted to add new models automatically into pakalon. 

And also about context managment, for each model there will be some limitations to be used, during the phase 1 after the plan.md file is created there should be another file to be created called as the conetxt_management.md(for both human in loop and yolo mode) and then in that file based upon the model that is choosed the context token is split for each phase like, for phase 1 the tokens to be used is this much like that the file should contain the details, the context that should be used by each phase and each agents and sub agents should be very less, how much the context can be reduced that much should it be redueced, the tokens should be limited to each phase that during the phase 1 when the AI agent is initalised and the plan.md file is created the token limitations  and token usage is set, each phases (AI agents and sub agents ) should plan their work and create the tasks according to this token limit only, 
If the human in loop, it should ask the user for choice like either all the token available can be used for this project or let the user type the % of token to be used, that percentage should be above 65% for new project and for already exsisting project it should be above 35%. And for YOLO mode, it should automatically assign the token percenatge. 
I want to add this also

5. And in the phase 3 during the testing process there should another file created that is the log file, in that log file from the 1st prompt , 1st file calling till the last step everything should be saved there like what are the codes that are written and tools and mcp servers that are called everything that should be mentioned here, so in the phase 3 sub agent 5 should look into this file and then validate and look out for any errors or issues in the application

I have given as when "/init" command is run then the .pakalon folder is created and the file structures also created inside that, but if the user simply asks some requests like make a change to css or ui to some exsisting projects my methodology wont work, for this method if the user simply asks some changes to the file or folder by entering the prompt the Agent coding capablites(tool calling, file edititing)  helps them to complete their task, when my methodolgy comes to play is that when the user is about to build some big full stack application or something else, that time when the user types as"/init" only .pakalon folder is created and all the file structure is created and then the phases from 1 to phase 6  agentic AI should start. If the project is already built to some extend then when the user initialses /init and then this command should understand what the project is about and about till what the user has created, for example if the user wants to create some e commerce website and already build 50% of the application using his own tech stack then the AI agent should be able to analyse this project codebase and then automatically fill the markdown files like
                            plan.md                # Build plan (NEW)
    │   │   │   ├── tasks.md               # Task breakdown (NEW)
    │   │   │   ├── design.md              # Design specs with Agent Skills (NEW)
    │   │   │   ├── phase-1.md             # Summary
    │   │   │   ├── agent-skills.md
    │   │   │   ├── prd.md
    │   │   │   ├── risk-assessment.md
    │   │   │   ├── user-stories.md
    │   │   │   ├── technical-spec.md
    │   │   │   ├── competitive-analysis.md
    │   │   │   └── constraints-and-tradeoffs.md
Subagents 3.md, subagents4.md like that. And if the project is not fully completed then upto which portion the project has comepleted till that the filling should happen. And also if the user has mentioned that no frontend design is needed then the frontend should remain the same. This is the complete working of pakalon methodolgy
The application can work even when .pakalon folder is not initalisied also and even when initalised also, so the working is divdied into 2 paths like when /init is run and when /init is not run.
2. And I will 1 API key from openrouter and use them in to my application and then when the user logs in and uses the application everytime he/she will be checked weather the user is pro or free user. 
And also I will be using dynamic refreshing model fetching method to use newly models which have been released inside openrouter newly. 
3.And also about context managment, for each model there will be some limitations to be used, during the phase 1 after the plan.md file is created there should be another file to be created called as the conetxt_management.md(for both human in loop and yolo mode) and then in that file based upon the model that is choosed the context token is split for each phase like, for phase 1 the tokens to be used is this much like that the file should contain the details, the context that should be used by each phase and each agents and sub agents should be very less, how much the context can be reduced that much should it be redueced, the tokens should be limited to each phase that during the phase 1 when the AI agent is initalised and the plan.md file is created the token limitations  and token usage is set, each phases (AI agents and sub agents ) should plan their work and create the tasks according to this token limit only, 
If the human in loop, it should ask the user for choice like either all the token available can be used for this project or let the user type the % of token to be used, that percentage should be above 65% for new project and for already exsisting project it should be above 35%. And for YOLO mode, it should automatically assign the token percenatge. 
I want to add this also
4. And in the phase 3 during the testing process there should another file created that is the log file, in that log file from the 1st prompt , 1st file calling till the last step everything should be saved there like what are the codes that are written and tools and mcp servers that are called everything that should be mentioned here, so in the phase 3 sub agent 5 should look into this file and then validate and look out for any errors or issues in the application
5. And also there is another command "/undo" when typed this the codes and the files should revereted, like when some changes in the application are made and the user thinks that this change which has been made is not need then when he types as "/undo" in the chat section, what changes that is made recently should show up (code and conversation) and then there should be a follow up question as : 1. Undo  conversation, 2. undo code, 3. undo code and conversation, 4. Do nothing 
1. When clicked on undo conversation, the last recent conversation is reverted no change in codebase
2. When clicked on undo code, the last recent code is reverted and no change in conversation
3. When clicked on undo code and conversation then the code and the conversation is reverted. 
4. When clicked on Do nothing, no changes happens and no tokens are consumed. 


I wanted to add this new feature also please add them into my application : And also there is another command "/undo" when typed this the codes and the files should revereted, like when some changes in the application are made and the user thinks that this change which has been made is not need then when he types as "/undo" in the chat section, what changes that is made recently should show up (code and conversation) and then there should be a follow up question as : 1. Undo  conversation, 2. undo code, 3. undo code and conversation, 4. Do nothing 
1. When clicked on undo conversation, the last recent conversation is reverted no change in codebase
2. When clicked on undo code, the last recent code is reverted and no change in conversation
3. When clicked on undo code and conversation then the code and the conversation is reverted. 
4. When clicked on Do nothing, no changes happens and no tokens are consumed. 

There are some additional features that I wanted to add to the application,
1. Normal mode of work doing, there is another process called agent team, where the user can create multiple agents and these agents can do parallel tasking, For example : For a project the user can be able to create more than 1 agents which can simultaneously work and then complete the tasks that are assigned to them. This agent teams how it would work is that by initializing via "/agents" when this command is run the question pops up and asking the user to name the agent and then create how to team members that the user needs. Despite the no.of the team members that is been created there will be a parent agent for each agent. To make this work happen the user may simply type the command as "/<The name that the user gave to the agent>" and then gives the prompt like let 1 user create one task and let the another user create another task if that means then, 2 works are done simultaneously and then report it to the parent agent that agent will verify their work done. This is the complete working of the team agents.

2. In pakalon mode of building the application, inside the plan.md file it should contain the prd doc and architecture and workflow, high level architecture, decisions, features like these the categories should be there for this plan.md file

3. Add the hooks features to both mode - when pakalon initailsed and normal mode
Exit 0 means success. pakalon should parse stdout for JSON output fields. JSON output is only processed on exit 0. For most events, stdout is only shown in verbose mode (Ctrl+O). The exceptions are UserPromptSubmit and SessionStart, where stdout is added as context that pakalon can see and act on.Exit 2 means a blocking error. Claude Code ignores stdout and any JSON in it. Instead, stderr text is fed back to Claude as an error message. The effect depends on the event: PreToolUse blocks the tool call, UserPromptSubmit rejects the prompt, and so on. See exit code 2 behavior for the full list.Any other exit code is a non-blocking error. stderr is shown in verbose mode (Ctrl+O) and execution continues

4. And When the pakalon is initalised in the phase 1 inside the user stories, there should be the sub categories based upon the user requirement if the requirement of the user is very big the user story may have sub category more than 20 , and if the user requirement is very less then the sub categaory may be in single digit also. The sub category are named from US-001, US-002, ... US-00n. Also these sub categories should contain the contents like acceptance criteria, test scenarios like that.
In simple the phase 1 is very important it should be able to generate the files which are mentioned in a very detailed and more explainatory manner so that the remaning phases and AI agents can work upon accordingly.

