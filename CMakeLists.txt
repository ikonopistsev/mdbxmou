cmake_minimum_required(VERSION 3.10)

project(mdbxmou)

add_definitions(-DNAPI_CPP_EXCEPTIONS)

option(MDBXMOU_TESTING "Enable internal native test hooks" OFF)

set(MDBXMOU_MIN_LIBMDBX_VERSION "0.14.3")
set(MDBXMOU_LIBMDBX_VERSION_FILE
    "${CMAKE_CURRENT_SOURCE_DIR}/deps/libmdbx/VERSION.json")
if(NOT EXISTS "${MDBXMOU_LIBMDBX_VERSION_FILE}")
  message(FATAL_ERROR
      "libmdbx submodule is missing. Run: git submodule update --init --recursive")
endif()
file(READ "${MDBXMOU_LIBMDBX_VERSION_FILE}" MDBXMOU_LIBMDBX_VERSION_JSON)
string(REGEX MATCH
    "\"semver\"[ \\t\\r\\n]*:[ \\t\\r\\n]*\"([0-9]+\\.[0-9]+\\.[0-9]+)"
    MDBXMOU_LIBMDBX_VERSION_MATCH
    "${MDBXMOU_LIBMDBX_VERSION_JSON}")
set(MDBXMOU_LIBMDBX_VERSION "${CMAKE_MATCH_1}")
if(NOT MDBXMOU_LIBMDBX_VERSION)
  message(FATAL_ERROR
      "Unable to read libmdbx version from ${MDBXMOU_LIBMDBX_VERSION_FILE}")
endif()
if("${MDBXMOU_LIBMDBX_VERSION}" VERSION_LESS
    "${MDBXMOU_MIN_LIBMDBX_VERSION}")
  message(FATAL_ERROR
      "mdbxmou requires libmdbx >= ${MDBXMOU_MIN_LIBMDBX_VERSION}, but found "
      "${MDBXMOU_LIBMDBX_VERSION}. Run:\n"
      "  git submodule sync --recursive\n"
      "  git submodule update --init --recursive")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if (MSVC)
  add_compile_options(/Zc:__cplusplus)
endif()

add_subdirectory("deps/libmdbx")

add_library(${PROJECT_NAME} SHARED
    "src/addon_state.cpp"
    "src/async/envmou_copy_to.cpp"
    "src/async/envmou_close.cpp"
    "src/async/envmou_query.cpp"
    "src/async/envmou_open.cpp"
    "src/async/envmou_keys.cpp"
    "src/modulemou.cpp"
    "src/querymou.cpp"
    "src/envmou.cpp" 
    "src/txnmou.cpp"
    "src/viewmou.cpp"
    "src/convmou.cpp"
    "src/dbimou.cpp"
    "src/cursormou.cpp"
    "src/dbi.cpp")

target_compile_definitions(${PROJECT_NAME} PRIVATE NAPI_VERSION=8)
if(MDBXMOU_TESTING)
  target_compile_definitions(${PROJECT_NAME} PRIVATE MDBXMOU_TESTING=1)
  target_sources(${PROJECT_NAME} PRIVATE "src/debug_writer.cpp")
endif()

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

# Batch read limit for mdbx_cursor_get_batch (pairs count = limit / 2)
if(NOT DEFINED MDBXMOU_BATCH_LIMIT)
    set(MDBXMOU_BATCH_LIMIT 512)
endif()
add_definitions(-DMDBXMOU_BATCH_LIMIT=${MDBXMOU_BATCH_LIMIT})
message(STATUS "MDBXMOU_BATCH_LIMIT: ${MDBXMOU_BATCH_LIMIT}")

# Include N-API wrappers
execute_process(COMMAND node -p "require('node-addon-api').include"
    WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    OUTPUT_VARIABLE NODE_ADDON_API_DIR
    )
string(REPLACE "\n" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})
string(REPLACE "\"" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})
target_include_directories(${PROJECT_NAME} PRIVATE ${NODE_ADDON_API_DIR} "src")
