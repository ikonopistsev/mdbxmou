cmake_minimum_required(VERSION 3.10)

project(mdbxmou)

add_definitions(-DNAPI_CPP_EXCEPTIONS)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if (MSVC)
  add_compile_options(/Zc:__cplusplus)
endif()

add_subdirectory("deps/libmdbx")

add_library(${PROJECT_NAME} SHARED
    "src/async/envmou_copy_to.cpp"
    "src/async/envmou_close.cpp"
    "src/async/envmou_query.cpp"
    "src/async/envmou_open.cpp"
    "src/async/envmou_keys.cpp"
    "src/modulemou.cpp"
    "src/querymou.cpp"
    "src/envmou.cpp" 
    "src/txnmou.cpp"
    "src/dbi.cpp"
    "src/dbimou.cpp")

# Gives our library file a .node extension without any "lib" prefix
set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")

# Essential include files to build a node addon,
# You should add this line in every CMake.js based project
target_include_directories(${PROJECT_NAME} PRIVATE ${CMAKE_JS_INC})

# Essential include files to build a node addon,
# You should add this line in every CMake.js based project
target_include_directories(${PROJECT_NAME} PRIVATE ${CMAKE_JS_INC})

# Essential library files to link to a node addon
# You should add this line in every CMake.js based project
target_link_libraries(${PROJECT_NAME} ${CMAKE_JS_LIB} mdbx-static)

if(MSVC)
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} /std:c++latest")
    target_link_libraries(${PROJECT_NAME} ntdll.lib)
endif()

# Include N-API wrappers
execute_process(COMMAND node -p "require('node-addon-api').include"
    WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    OUTPUT_VARIABLE NODE_ADDON_API_DIR
    )
string(REPLACE "\n" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})
string(REPLACE "\"" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})
target_include_directories(${PROJECT_NAME} PRIVATE ${NODE_ADDON_API_DIR} "src")


